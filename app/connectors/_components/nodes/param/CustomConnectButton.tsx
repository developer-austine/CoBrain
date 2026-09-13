"use client";

import React, { useCallback, useState }  from "react";
import { useReactFlow }                  from "@xyflow/react";
import { Button }                        from "@/components/ui/button";
import { Badge }                         from "@/components/ui/badge";
import { AppNode }                       from "@/types/appNode";
import { TaskParam }                     from "@/types/task";
import { useWorkflowId }                 from "../../WorkflowContext";
import {
  GlobeIcon, CheckCircle2, Loader2,
  AlertCircle, RefreshCw, CopyIcon,
  CheckIcon, KeyRoundIcon, WebhookIcon,
} from "lucide-react";

interface Props {
  param:                TaskParam;
  nodeId:               string;
  updateNodeParamValue: (value: string) => void;
}

type Status = "idle" | "generated" | "connected" | "checking" | "error";

interface Credentials {
  clientId:      string;
  clientSecret:  string;
  webhookSecret: string;
  ingestUrl:     string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-1 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied
        ? <CheckIcon size={10} className="text-green-500" />
        : <CopyIcon  size={10} />
      }
    </button>
  );
}

function CredRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
        {label}
      </span>
      <div className="flex items-center gap-1 bg-muted/50 rounded px-1.5 py-1">
        <span className="text-[10px] font-mono truncate flex-1 text-foreground/80">
          {value}
        </span>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

export default function CustomAPIConnectButton({
  param,
  nodeId,
  updateNodeParamValue,
}: Props) {
  const { getNode }  = useReactFlow();
  const workflowId   = useWorkflowId();

  const node       = getNode(nodeId) as AppNode | undefined;
  const savedValue = node?.data.inputs?.[param.name] ?? "";

  // savedValue format: "connected:<clientId>" or "generated:<clientId>"
  const isAlreadySetup = savedValue.startsWith("connected:") || savedValue.startsWith("generated:");
  const savedClientId  = isAlreadySetup ? savedValue.split(":")[1] : "";

  const [status,      setStatus]      = useState<Status>(isAlreadySetup ? "generated" : "idle");
  const [creds,       setCreds]       = useState<Credentials | null>(null);
  const [name,        setName]        = useState<string>("");
  const [errMsg,      setErrMsg]      = useState<string>("");
  const [lastSync,    setLastSync]    = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(savedValue.startsWith("connected:"));

  const handleGenerate = useCallback(async () => {
    if (!workflowId || !name.trim()) return;

    setStatus("checking");
    setErrMsg("");

    try {
      const res = await fetch("/api/custom_api/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ workflowId, nodeId, name: name.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate credentials");

      setCreds(data);
      setStatus("generated");
      updateNodeParamValue(`generated:${data.clientId}`);
    } catch (err: any) {
      setErrMsg(err.message ?? "Unknown error");
      setStatus("error");
    }
  }, [workflowId, nodeId, name, updateNodeParamValue]);

  const handleCheckStatus = useCallback(async () => {
    if (!workflowId) return;
    setStatus("checking");

    try {
      const res  = await fetch(
        `/api/custom_api/status?workflowId=${workflowId}&nodeId=${nodeId}`
      );
      const data = await res.json();

      if (data.connected) {
        setIsConnected(true);
        setLastSync(data.lastSyncAt ?? null);
        setStatus("connected");
        updateNodeParamValue(`connected:${savedClientId || creds?.clientId}`);
      } else {
        setStatus("generated");
        setLastSync(null);
      }
    } catch {
      setStatus("generated");
    }
  }, [workflowId, nodeId, savedClientId, creds, updateNodeParamValue]);

  if (status === "idle" || status === "error") {
    return (
      <div className="flex flex-col gap-2 w-full">
        <input
          type="text"
          placeholder="Name this source (e.g. CRM API)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full h-7 px-2 text-xs rounded border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs gap-1.5"
          onClick={handleGenerate}
          disabled={!workflowId || !name.trim()}
        >
          <KeyRoundIcon size={11} />
          Generate API Credentials
        </Button>

        {errMsg && (
          <p className="text-[10px] text-destructive flex items-center gap-1">
            <AlertCircle size={10} /> {errMsg}
          </p>
        )}
      </div>
    );
  }

  if (status === "checking") {
    return (
      <div className="flex items-center gap-1.5 w-full text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        {creds ? "Generating credentials…" : "Checking status…"}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">

      {/* Status badge row */}
      <div className="flex items-center gap-1.5">
        {isConnected
          ? <CheckCircle2 size={12} className="text-green-500 shrink-0" />
          : <GlobeIcon    size={12} className="text-amber-500 shrink-0" />
        }
        <span className="text-[10px] text-muted-foreground truncate flex-1">
          {creds ? name : "Custom API"}
        </span>
        <Badge
          variant="secondary"
          className={`text-[9px] px-1 py-0 h-3.5 shrink-0 font-normal ${
            isConnected
              ? "bg-green-500/15 text-green-600"
              : "bg-amber-500/15 text-amber-600"
          }`}
        >
          {isConnected ? "receiving data" : "awaiting data"}
        </Badge>
      </div>

      {creds && (
        <div className="flex flex-col gap-1.5 p-2 rounded-md border bg-muted/20">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground/60 font-medium">
            Credentials — copy to your system
          </p>

          <CredRow label="Client ID"      value={creds.clientId}      />
          <CredRow label="Client Secret"  value={creds.clientSecret}  />
          <CredRow label="Webhook Secret" value={creds.webhookSecret} />

          <div className="flex flex-col gap-0.5 mt-0.5">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
              Ingest URL
            </span>
            <div className="flex items-center gap-1 bg-muted/50 rounded px-1.5 py-1">
              <WebhookIcon size={9} className="text-muted-foreground shrink-0" />
              <span className="text-[10px] font-mono truncate flex-1 text-foreground/80">
                {creds.ingestUrl}
              </span>
              <CopyButton text={creds.ingestUrl} />
            </div>
          </div>

          <p className="text-[9px] text-muted-foreground/60 mt-0.5 leading-relaxed">
            Your system should POST data to the ingest URL with:
            <br />
            <code className="font-mono">Authorization: Bearer custom_{"{clientId}"}_{"{secret}"}</code>
          </p>
        </div>
      )}

      {lastSync && (
        <p className="text-[10px] text-green-600">
          ✓ Last data received: {new Date(lastSync).toLocaleString()}
        </p>
      )}

      {/* Check status button */}
      <Button
        size="sm"
        variant="secondary"
        className="w-full h-7 text-xs gap-1.5"
        onClick={handleCheckStatus}
      >
        <RefreshCw size={11} />
        Check Connection Status
      </Button>

      {/* Regenerate option */}
      <button
        onClick={() => { setStatus("idle"); setCreds(null); setIsConnected(false); }}
        className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground text-center transition-colors"
      >
        Regenerate credentials
      </button>
    </div>
  );
}