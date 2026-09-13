"use client";

import { TaskParam, TaskParamType }  from "@/types/task";
import { useReactFlow }              from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import { toast }                     from "sonner";
import { AppNode }                   from "@/types/appNode";
import { UpdateWorkflow }            from "@/actions/workflows/updateWorkflow";
import { useWorkflowId }             from "../WorkflowContext";
import StringParam                   from "./param/StringParam";
import BrowserInstanceParam          from "./param/BrowserInstanceParam";
import GmailConnectButton            from "./param/GmailConnectButton";
import NotionConnectButton           from "./param/NotionConnectButton";
import GithubConnectButton from "./param/GithubConnectorButton";
import CustomConnectButton from "./param/CustomConnectButton";
import SlackConnectButton from "./param/SlackConnectButton";
import DriveConnectButton from "./param/DriveConnectButton";

/**
 * How long to wait after the last param change before writing to the database.
 *
 * Long enough that typing a repository name is one save rather than twenty,
 * short enough that a connect popup closing and the user immediately navigating
 * away still lands.
 */
const AUTOSAVE_DELAY_MS = 700;

function NodeParamField({ param, nodeId }: { param: TaskParam; nodeId: string }) {
  const { updateNodeData, getNode, toObject } = useReactFlow();
  const workflowId = useWorkflowId();
  const node  = getNode(nodeId) as AppNode;
  const value = node?.data.inputs?.[param.name] ?? "";

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending save must not outlive the editor, or it writes a canvas the user
  // has already navigated away from.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  /**
   * Persist the whole canvas shortly after a parameter changes.
   *
   * Connecting a source (GitHub, Gmail, Slack…) writes `connected:<id>` into
   * the node through updateNodeParamValue. That lived only in React Flow's
   * in-memory store: the OAuth popup never navigates the editor, so nothing
   * forced a re-render from the database and the loss stayed invisible until a
   * reload, when the node came back unconnected and the pipeline looked like it
   * had reverted to the default. The connection row itself was always in
   * Postgres — it was the node pointing at it that went missing.
   *
   * Deliberately debounced and read at FLUSH time rather than now:
   * updateNodeData lands through React state, so toObject() called immediately
   * would serialise the canvas as it was before this very edit.
   */
  const scheduleSave = useCallback(() => {
    if (!workflowId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      UpdateWorkflow({
        id: workflowId,
        definition: JSON.stringify(toObject()),
      }).catch(() => {
        // Silent on success — this is a background save the user did not ask
        // for. Never silent on failure: the whole point is that they stop
        // losing work without being told.
        toast.error("Could not save the connection. Press Save to retry.", {
          id: "autosave-workflow",
        });
      });
    }, AUTOSAVE_DELAY_MS);
  }, [workflowId, toObject]);

  const updateNodeParamValue = useCallback(
    (newValue: string) => {
      updateNodeData(nodeId, {
        inputs: { ...node?.data.inputs, [param.name]: newValue },
      });
      scheduleSave();
    },
    [nodeId, updateNodeData, param.name, node?.data.inputs, scheduleSave]
  );

  switch (param.type) {
    case TaskParamType.STRING:
      return (
        <StringParam
          param={param}
          value={value}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

    case TaskParamType.BROWSER_INSTANCE:
      return (
        <BrowserInstanceParam
          param={param}
          value={value}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

    case TaskParamType.GMAIL_CONNECT:
      return (
        <GmailConnectButton
          param={param}
          nodeId={nodeId}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

    case TaskParamType.SLACK_CONNECT:
      return (
        <SlackConnectButton
          param={param}
          nodeId={nodeId}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

    case TaskParamType.DRIVE_CONNECT:
      return (
        <DriveConnectButton
          param={param}
          nodeId={nodeId}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

    case TaskParamType.NOTION_CONNECT:
      return (
        <NotionConnectButton
          param={param}
          nodeId={nodeId}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

      case TaskParamType.GITHUB_CONNECT:
      return (
        <GithubConnectButton
          param={param}
          nodeId={nodeId}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

      case TaskParamType.CUSTOM_CONNECT:
      return (
        <CustomConnectButton
          param={param}
          nodeId={nodeId}
          updateNodeParamValue={updateNodeParamValue}
        />
      );

    case TaskParamType.NUMBER:
      return (
        <div className="flex flex-col gap-1 w-full">
          {param.helperText && (
            <p className="text-[10px] text-muted-foreground">{param.helperText}</p>
          )}
          <input
            type="number"
            className="w-full h-7 px-2 text-xs rounded border bg-background text-foreground"
            defaultValue={value || param.value || ""}
            onChange={(e) => updateNodeParamValue(e.target.value)}
          />
        </div>
      );

    case TaskParamType.BOOLEAN:
      return (
        <div className="flex items-center gap-2 w-full">
          <input
            type="checkbox"
            className="w-3.5 h-3.5 accent-primary"
            defaultChecked={value === "true" || param.value === "true"}
            onChange={(e) => updateNodeParamValue(String(e.target.checked))}
          />
          <span className="text-xs text-muted-foreground">{param.name}</span>
        </div>
      );

    case TaskParamType.SELECT:
      return (
        <div className="flex flex-col gap-1 w-full">
          {param.helperText && (
            <p className="text-[10px] text-muted-foreground">{param.helperText}</p>
          )}
          <select
            className="w-full h-7 px-2 text-xs rounded border bg-background text-foreground"
            defaultValue={value || param.value || ""}
            onChange={(e) => updateNodeParamValue(e.target.value)}
          >
            {param.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    default:
      return (
        <div className="w-full">
          <p className="text-xs text-muted-foreground">Not Implemented</p>
        </div>
      );
  }
}

export default NodeParamField;