"use client";

import { Badge }         from "@/components/ui/badge";
import { Button }        from "@/components/ui/button";
import { TaskRegistry }  from "@/lib/connector/task/registry";
import { TaskType }      from "@/types/task";
import { GripVerticalIcon } from "lucide-react";
import React             from "react";
import { useReactFlow }  from "@xyflow/react";
import { AppNode }       from "@/types/appNode";
import { cn }            from "@/lib/utils";
import ConnectorIconPicker from "./ConnectorIconPicker";
import { getConnectorIcon } from "@/assets/connector-icons";

interface NodeHeaderProps {
  taskType: TaskType;
  nodeId: string;
}

export default function NodeHeader({ taskType, nodeId }: NodeHeaderProps) {
  const task = TaskRegistry[taskType as keyof typeof TaskRegistry];
  const { getNode } = useReactFlow();
  const node = getNode(nodeId) as AppNode | undefined;
  const assignedIconDef = node?.data?.connectorIconId
    ? getConnectorIcon(node.data.connectorIconId)
    : undefined;

  return (
    <div className="flex flex-col">
      {/* ── Main header row ── */}
      <div className="flex items-center gap-2 p-2">

        {/* App icon badge — shows assigned icon OR falls back to task icon */}
        <span
          className={cn(
            "w-6 h-6 rounded flex items-center justify-center shrink-0",
            assignedIconDef
              ? assignedIconDef.bgColor
              : "bg-muted"
          )}
        >
          {assignedIconDef ? (
            <assignedIconDef.icon size={14} className={assignedIconDef.color} />
          ) : (
            <task.icon size={14} />
          )}
        </span>

        {/* Label + badges row */}
        <div className="flex justify-between items-center w-full min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-xs font-bold uppercase text-muted-foreground truncate">
              {assignedIconDef ? assignedIconDef.label : task.label}
            </p>
          </div>

          <div className="flex gap-1 items-center shrink-0">
            {task.isEntryPoint && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                Entry
              </Badge>
            )}
            {/* Drag handle */}
            <Button
              variant="ghost"
              size="icon"
              className="drag-handle cursor-grab w-6 h-6"
            >
              <GripVerticalIcon size={14} />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Connector icon picker row ── */}
      <div className="px-2 pb-2 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/50 shrink-0">App:</span>
        <ConnectorIconPicker nodeId={nodeId} />
      </div>
    </div>
  );
}