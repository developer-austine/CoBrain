"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useReactFlow } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppNode } from "@/types/appNode";
import { TaskParam } from "@/types/task";
import { useWorkflowId } from "../../WorkflowContext";
import { CheckCircle2, Loader2, AlertCircle, RefreshCw, PlugZap } from "lucide-react";

interface Props {
  param: TaskParam;
  nodeId: string;
  updateNodeParamValue: (value: string) => void;
}

type Status = "idle" | "connected" | "syncing" | "error";

/**
 * Slack OAuth + sync control, matching the Gmail/Notion nodes.
 *
 * The popup is polled for close rather than listened to via postMessage: the
 * callback lands on our own origin and then redirects, so there is no reliable
 * moment to post from, and a user who closes the window early must still leave
 * the node in a truthful state.
 */
export default function SlackConnectButton({ param, nodeId, updateNodeParamValue }: Props) {
  const { getNode } = useReactFlow();
  const searchParams = useSearchParams();
  const workflowId = useWorkflowId();

  const node = getNode(nodeId) as AppNode | undefined;
  const savedValue = node?.data.inputs?.[param.name] ?? "";

  const isAlreadyConnected = savedValue.startsWith("connected:");
  const [status, setStatus] = useState<Status>(isAlreadyConnected ? "connected" : "idle");
  const [account, setAccount] = useState<string>(
    isAlreadyConnected ? savedValue.replace("connected:", "") : ""
  );
  const [syncMsg, setSyncMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    const connected = searchParams.get("slackConnected");
    const cbNodeId = searchParams.get("nodeId");
    if (connected !== "true" || cbNodeId !== nodeId || status === "connected") return;

    fetch(`/api/slack/status?workflowId=${workflowId}&nodeId=${nodeId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.teamName) return;
        setAccount(data.teamName);
        setStatus("connected");
        updateNodeParamValue(`connected:${data.teamName}`);
      })
      // A status read that fails leaves the node as it was — better than
      // reporting "not connected" for what is only a network blip.
      .catch(() => {});
  }, [searchParams, nodeId, workflowId, status, updateNodeParamValue]);

  const handleConnect = () => {
    if (!workflowId) return;
    const url = `/api/slack/auth?nodeId=${nodeId}&workflowId=${workflowId}`;
    const popup = window.open(url, "slackOAuth", "width=520,height=720,left=200,top=80");
    popupRef.current = popup;

    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        fetch(`/api/slack/status?workflowId=${workflowId}&nodeId=${nodeId}`)
          .then((r) => r.json())
          .then((data) => {
            if (!data.teamName) return;
            setAccount(data.teamName);
            setStatus("connected");
            updateNodeParamValue(`connected:${data.teamName}`);
          })
          .catch(() => {});
      }
    }, 800);
  };

  const handleSync = async () => {
    if (!workflowId) return;
    setStatus("syncing");
    setSyncMsg("");
    setErrMsg("");

    try {
      const res = await fetch("/api/slack/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, nodeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncMsg(`${data.synced} messages synced`);
      setStatus("connected");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  if (status === "idle" || status === "error") {
    return (
      <div className="flex flex-col gap-1 w-full">
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs gap-1.5"
          onClick={handleConnect}
          disabled={!workflowId}
        >
          <PlugZap size={12} />
          Connect Slack
        </Button>
        {errMsg && (
          <p className="text-[10px] text-destructive flex items-center gap-1">
            <AlertCircle size={10} /> {errMsg}
          </p>
        )}
      </div>
    );
  }

  if (status === "syncing") {
    return (
      <div className="flex items-center gap-1.5 w-full text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Syncing messages…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 size={12} className="text-green-500 shrink-0" />
        <span className="text-[10px] text-muted-foreground truncate">{account}</span>
        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 ml-auto shrink-0">
          connected
        </Badge>
      </div>

      <Button size="sm" variant="secondary" className="w-full h-7 text-xs gap-1.5" onClick={handleSync}>
        <RefreshCw size={11} />
        Sync messages
      </Button>

      {syncMsg && <p className="text-[10px] text-green-600">{syncMsg}</p>}
    </div>
  );
}
