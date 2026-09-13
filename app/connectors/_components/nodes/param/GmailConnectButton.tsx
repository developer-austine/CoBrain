"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams }   from "next/navigation";
import { useReactFlow }      from "@xyflow/react";
import { Button }            from "@/components/ui/button";
import { Badge }             from "@/components/ui/badge";
import { AppNode }           from "@/types/appNode";
import { TaskParam }         from "@/types/task";
import { MailIcon, CheckCircle2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useWorkflowId } from "../../WorkflowContext"; 


interface Props {
  param:                 TaskParam;
  nodeId:                string;
  updateNodeParamValue:  (value: string) => void;
}

type Status = "idle" | "connected" | "syncing" | "error";

export default function GmailConnectButton({ param, nodeId, updateNodeParamValue }: Props) {
  const { getNode } = useReactFlow();
  const searchParams = useSearchParams();

  const workflowId = useWorkflowId()

  const node = getNode(nodeId) as AppNode | undefined;
  const savedValue: string = node?.data.inputs?.[param.name] ?? "";

  const isAlreadyConnected = savedValue.startsWith("connected:");
  const connectedEmail      = isAlreadyConnected ? savedValue.replace("connected:", "") : "";

  const [status, setStatus]     = useState<Status>(isAlreadyConnected ? "connected" : "idle");
  const [email, setEmail]       = useState<string>(connectedEmail);
  const [syncMsg, setSyncMsg]   = useState<string>("");
  const [errMsg, setErrMsg]     = useState<string>("");
  const popupRef                = useRef<Window | null>(null);

  useEffect(() => {
    const connected = searchParams.get("gmailConnected");
    const cbNodeId  = searchParams.get("nodeId");
    if (connected === "true" && cbNodeId === nodeId && status !== "connected") {
      // Fetch which email was just linked
      fetch(`/api/gmail/status?workflowId=${workflowId}&nodeId=${nodeId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.email) {
            setEmail(data.email);
            setStatus("connected");
            updateNodeParamValue(`connected:${data.email}`);
          }
        })
        .catch(() => {});
    }
  }, [searchParams, nodeId, workflowId, status, updateNodeParamValue]);

  const handleConnect = useCallback(() => {
    if (!workflowId) return;
    const url = `/api/gmail/auth?nodeId=${nodeId}&workflowId=${workflowId}`;
    const popup = window.open(url, "gmailOAuth", "width=520,height=640,left=200,top=100");
    popupRef.current = popup;

    // Poll for the popup to close then check status
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        // Check if the connection was saved (popup may have finished the redirect)
        fetch(`/api/gmail/status?workflowId=${workflowId}&nodeId=${nodeId}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.email) {
              setEmail(data.email);
              setStatus("connected");
              updateNodeParamValue(`connected:${data.email}`);
            }
          })
          .catch(() => {});
      }
    }, 800);
  }, [nodeId, workflowId, updateNodeParamValue]);

  const handleSync = useCallback(async () => {
    if (!workflowId) return;
    setStatus("syncing");
    setSyncMsg("");
    setErrMsg("");

    try {
      const res = await fetch("/api/gmail/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ workflowId, nodeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncMsg(`${data.synced} emails synced`);
      setStatus("connected");
    } catch (err: any) {
      setErrMsg(err.message ?? "Unknown error");
      setStatus("error");
    }
  }, [workflowId, nodeId]);

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
          <MailIcon size={12} />
          Connect Gmail
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
        Syncing inbox…
      </div>
    );
  }

  // connected
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 size={12} className="text-green-500 shrink-0" />
        <span className="text-[10px] text-muted-foreground truncate">{email}</span>
        <Badge
          variant="secondary"
          className="text-[9px] px-1 py-0 h-3.5 ml-auto shrink-0"
        >
          connected
        </Badge>
      </div>

      <Button
        size="sm"
        variant="secondary"
        className="w-full h-7 text-xs gap-1.5"
        onClick={handleSync}
      >
        <RefreshCw size={11} />
        Sync Inbox
      </Button>

      {syncMsg && (
        <p className="text-[10px] text-green-600">{syncMsg}</p>
      )}
    </div>
  );
}