"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams }  from "next/navigation";
import { useReactFlow }     from "@xyflow/react";
import { Button }           from "@/components/ui/button";
import { Badge }            from "@/components/ui/badge";
import { AppNode }          from "@/types/appNode";
import { TaskParam }        from "@/types/task";
import { useWorkflowId }    from "../../WorkflowContext";
import {
  BookOpenIcon,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface Props {
  param:                TaskParam;
  nodeId:               string;
  updateNodeParamValue: (value: string) => void;
}

type Status = "idle" | "connected" | "syncing" | "error";

export default function NotionConnectButton({
  param,
  nodeId,
  updateNodeParamValue,
}: Props) {
  const { getNode }    = useReactFlow();
  const searchParams   = useSearchParams();
  const workflowId     = useWorkflowId();

  const node           = getNode(nodeId) as AppNode | undefined;
  const savedValue     = node?.data.inputs?.[param.name] ?? "";

  // Saved value format: "connected:<workspaceName>" — same as Gmail's "connected:<email>"
  const isAlreadyConnected = savedValue.startsWith("connected:");
  const connectedWorkspace = isAlreadyConnected
    ? savedValue.replace("connected:", "")
    : "";

  const [status,      setStatus]      = useState<Status>(isAlreadyConnected ? "connected" : "idle");
  const [workspace,   setWorkspace]   = useState<string>(connectedWorkspace);
  const [syncMsg,     setSyncMsg]     = useState<string>("");
  const [errMsg,      setErrMsg]      = useState<string>("");
  const popupRef = useRef<Window | null>(null);

  //  Read callback query params — mirrors Gmail useEffect 
  useEffect(() => {
    const connected = searchParams.get("notionConnected");
    const cbNodeId  = searchParams.get("nodeId");

    if (connected === "true" && cbNodeId === nodeId && status !== "connected") {
      fetch(`/api/notion/status?workflowId=${workflowId}&nodeId=${nodeId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.workspaceName) {
            setWorkspace(data.workspaceName);
            setStatus("connected");
            updateNodeParamValue(`connected:${data.workspaceName}`);
          }
        })
        .catch(() => {});
    }
  }, [searchParams, nodeId, workflowId, status, updateNodeParamValue]);

  //  Open OAuth popup — mirrors Gmail handleConnect 
  const handleConnect = useCallback(() => {
    if (!workflowId) return;

    const url    = `/api/notion/auth?nodeId=${nodeId}&workflowId=${workflowId}`;
    const popup  = window.open(url, "notionOAuth", "width=520,height=720,left=200,top=80");
    popupRef.current = popup;

    // Poll for popup close then check status — mirrors Gmail polling pattern
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        fetch(`/api/notion/status?workflowId=${workflowId}&nodeId=${nodeId}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.workspaceName) {
              setWorkspace(data.workspaceName);
              setStatus("connected");
              updateNodeParamValue(`connected:${data.workspaceName}`);
            }
          })
          .catch(() => {});
      }
    }, 800);
  }, [nodeId, workflowId, updateNodeParamValue]);

  //  Trigger sync — mirrors Gmail handleSync ─
  const handleSync = useCallback(async () => {
    if (!workflowId) return;
    setStatus("syncing");
    setSyncMsg("");
    setErrMsg("");

    try {
      const res = await fetch("/api/notion/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ workflowId, nodeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncMsg(`${data.synced} pages synced`);
      setStatus("connected");
    } catch (err: any) {
      setErrMsg(err.message ?? "Unknown error");
      setStatus("error");
    }
  }, [workflowId, nodeId]);

  //  Render: idle or error 
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
          <BookOpenIcon size={12} />
          Connect Notion
        </Button>
        {errMsg && (
          <p className="text-[10px] text-destructive flex items-center gap-1">
            <AlertCircle size={10} /> {errMsg}
          </p>
        )}
      </div>
    );
  }

  //  Render: syncing 
  if (status === "syncing") {
    return (
      <div className="flex items-center gap-1.5 w-full text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Syncing workspace…
      </div>
    );
  }

  //  Render: connected 
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 size={12} className="text-green-500 shrink-0" />
        <span className="text-[10px] text-muted-foreground truncate">
          {workspace}
        </span>
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
        Sync Workspace
      </Button>

      {syncMsg && (
        <p className="text-[10px] text-green-600">{syncMsg}</p>
      )}
    </div>
  );
}