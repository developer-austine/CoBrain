"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSpeechToText — AssemblyAI Universal Streaming, v3 (blueprint §7).
 *
 * Voice is ONLY an input method: mic → 16 kHz PCM16 chunks → WebSocket →
 * partial transcripts stream back into the prompt box → the final text goes
 * through the exact same submission flow as typed text.
 *
 * v3 protocol (the v2 realtime API is retired and 404s):
 *   - connect: wss://streaming.assemblyai.com/v3/ws?sample_rate&token
 *   - audio:   raw PCM16 sent as BINARY frames (v2 base64-in-JSON is gone)
 *   - results: {type:"Turn", transcript, end_of_turn, turn_is_formatted}
 *   - close:   {type:"Terminate"}
 */

export type SttState = "idle" | "connecting" | "listening" | "error";

type Options = {
  /** Live partial transcript (replaces the previous partial). */
  onPartial?: (text: string) => void;
  /** A finalized utterance (append to the prompt). */
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
};

const SAMPLE_RATE = 16000;

export function useSpeechToText({ onPartial, onFinal, onError }: Options) {
  const [state, setState] = useState<SttState>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const callbacksRef = useRef({ onPartial, onFinal, onError });
  callbacksRef.current = { onPartial, onFinal, onError };
  // Live microphone loudness (0–1), updated off the audio thread. Consumers read
  // it via requestAnimationFrame — it is intentionally NOT React state.
  const levelRef = useRef(0);

  const cleanup = useCallback(() => {
    levelRef.current = 0;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "Terminate" }));
    }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setState("idle");
  }, [cleanup]);

  const fail = useCallback(
    (message: string) => {
      cleanup();
      setState("error");
      callbacksRef.current.onError?.(message);
      // Auto-recover to idle so the button is usable again.
      setTimeout(() => setState((s) => (s === "error" ? "idle" : s)), 50);
    },
    [cleanup]
  );

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setState("connecting");

    // 1. Short-lived token (key never reaches the browser).
    let token: string;
    try {
      const r = await fetch("/api/stt/token", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Voice unavailable");
      token = data.token;
    } catch (err) {
      fail(err instanceof Error ? err.message : "Voice unavailable");
      return;
    }

    // 2. Microphone.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      fail("Microphone access was denied");
      return;
    }
    streamRef.current = stream;

    // 3. WebSocket to AssemblyAI Universal Streaming (v3).
    //    format_turns=true gives punctuated/cased text on the final turn.
    const params = new URLSearchParams({
      sample_rate: String(SAMPLE_RATE),
      encoding: "pcm_s16le",
      format_turns: "true",
      token,
    });
    const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // 4. Pump 16 kHz PCM16 chunks. ScriptProcessor is deprecated but remains
      // the most portable capture path; swap for AudioWorklet when we need
      // lower latency.
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      const sourceNode = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        let sumSquares = 0;
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          sumSquares += s * s;
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Expose a smoothed 0–1 loudness so the UI waveform can react to the
        // actual voice. Written to a ref (not state) — this fires ~4×/sec and
        // must never trigger a React render; the pill samples it via rAF.
        const rms = Math.sqrt(sumSquares / input.length);
        // Speech RMS is small (~0.02–0.2); normalise into a lively 0–1 range.
        const normalized = Math.min(1, rms * 6);
        levelRef.current = levelRef.current * 0.7 + normalized * 0.3;

        // v3 takes raw PCM16 as a binary frame — no base64/JSON wrapper.
        ws.send(pcm.buffer);
      };

      sourceNode.connect(processor);
      processor.connect(ctx.destination);
      setState("listening");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.type === "Turn") {
          const text: string = msg.transcript ?? "";
          if (!text) return;

          // With format_turns=true each finished turn arrives twice: once raw,
          // then again punctuated/cased. Only the formatted one is final —
          // treating both as final would append the utterance twice.
          if (msg.end_of_turn) {
            if (msg.turn_is_formatted) callbacksRef.current.onFinal?.(text);
            else callbacksRef.current.onPartial?.(text);
          } else {
            callbacksRef.current.onPartial?.(text);
          }
          return;
        }

        // {type:"Begin"} / {type:"Termination"} are lifecycle frames — ignore.
        if (msg.error) fail(String(msg.error));
      } catch {
        /* non-JSON frames are ignored */
      }
    };

    ws.onerror = () => fail("Voice connection failed");
    ws.onclose = () => {
      // Server-initiated close while we thought we were listening.
      setState((s) => (s === "listening" || s === "connecting" ? "idle" : s));
    };
  }, [state, fail]);

  useEffect(() => cleanup, [cleanup]);

  return { state, start, stop, levelRef };
}
