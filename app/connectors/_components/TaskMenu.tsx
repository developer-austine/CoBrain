"use client";

import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TaskType } from "@/types/task";
import { TaskRegistry } from "@/lib/connector/task/registry";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TASK_GROUPS: { label: string; types: TaskType[] }[] = [
  {
    label: "Sources",
    types: [
      TaskType.GMAIL_SOURCE,
      TaskType.SLACK_SOURCE,
      TaskType.NOTION_SOURCE,
      TaskType.DRIVE_SOURCE,
      TaskType.JIRA_SOURCE,
      TaskType.LINEAR_SOURCE,
      TaskType.GITHUB_SOURCE,
      TaskType.CONFLUENCE_SOURCE,
      TaskType.CUSTOM_API_SOURCE,
    ],
  },
  {
    label: "Pipeline",
    types: [
      TaskType.NORMALIZER,
      TaskType.PII_SCRUBBER,
      TaskType.CHUNKER,
      TaskType.EMBEDDER,
      TaskType.DEDUPLICATOR,
      TaskType.VECTOR_STORE,
    ],
  },
  {
    label: "AI / Output",
    types: [
      TaskType.RAG_ENGINE,
      TaskType.ANALYSIS_AGENT,
      TaskType.FORECAST_ENGINE,
    ],
  },
  {
    label: "Utilities",
    types: [
      TaskType.LAUNCH_BROWSER,
      TaskType.PAGE_TO_HTML,
      TaskType.EXTRACT_TEXT_FROM_ELEMENT,
    ],
  },
];

function TaskMenuButton({ taskType }: { taskType: TaskType }) {
  const task = TaskRegistry[taskType as keyof typeof TaskRegistry];
  if (!task) return null;

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/reactflow", taskType);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <Button
      variant="secondary"
      className="flex items-center gap-2 w-full justify-start h-8 text-xs cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
    >
      <task.icon size={14} className="shrink-0" />
      <span className="truncate">{task.label}</span>
      {task.isEntryPoint && (
        <Badge
          variant="outline"
          className="text-[9px] px-1 py-0 h-3.5 ml-auto shrink-0 font-normal"
        >
          Entry
        </Badge>
      )}
    </Button>
  );
}

export default function TaskMenu() {
  return (
    <aside className="w-[220px] min-w-[220px] border-r bg-background flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 border-b sticky top-0 bg-background z-10">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Connectors
        </p>
      </div>

      <Accordion
        defaultValue={TASK_GROUPS.map((g) => g.label)}
        className="px-2 py-2"
      >
        {TASK_GROUPS.map((group) => (
          <AccordionItem key={group.label} value={group.label} className="border-none">
            <AccordionTrigger className="text-xs py-1.5 font-medium text-muted-foreground hover:no-underline">
              {group.label}
            </AccordionTrigger>
            <AccordionContent className="pb-1">
              <div className="flex flex-col gap-1">
                {group.types.map((type) => (
                  <TaskMenuButton key={type} taskType={type} />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </aside>
  );
}