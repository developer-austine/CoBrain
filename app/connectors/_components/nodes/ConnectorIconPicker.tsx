"use client";

import React, { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONNECTOR_ICONS } from "@/assets/connector-icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AppNode } from "@/types/appNode";
import { ConnectorIconDefinition } from "@/assets/connector-icons/types";

interface ConnectorIconPickerProps {
  nodeId: string;
}

type CategoryKey = "source" | "pipeline" | "ai";

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "source",   label: "Data Sources" },
  { key: "pipeline", label: "Pipeline"     },
  { key: "ai",       label: "AI Layer"     },
];

export default function ConnectorIconPicker({ nodeId }: ConnectorIconPickerProps) {
  const { getNode, updateNodeData } = useReactFlow();
  const node = getNode(nodeId) as AppNode | undefined;
  const currentId = node?.data?.connectorIconId;
  const current = CONNECTOR_ICONS.find((c) => c.id === currentId);

  const [open, setOpen] = useState(false);

  const handleSelect = (icon: ConnectorIconDefinition) => {
    updateNodeData(nodeId, { connectorIconId: icon.id });
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNodeData(nodeId, { connectorIconId: undefined });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <div
          role="button"
          className={cn(
            "inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-xs font-normal cursor-pointer",
            "border border-dashed border-muted-foreground/30",
            "hover:border-primary/50 hover:bg-primary/5",
            "transition-all duration-150 select-none",
            current && "border-solid border-muted-foreground/50"
          )}
        >
          {current ? (
            <>
              <span className={cn("flex items-center", current.color)}>
                <current.icon size={12} />
              </span>
              <span className="text-muted-foreground max-w-[72px] truncate">
                {current.label}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(e) => e.key === "Enter" && handleClear(e as unknown as React.MouseEvent)}
                className="ml-0.5 text-muted-foreground/60 hover:text-destructive"
              >
                ×
              </span>
            </>
          ) : (
            <>
              <span className="text-muted-foreground/50">Set app</span>
              <ChevronDownIcon size={10} className="text-muted-foreground/40" />
            </>
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="start"
        className="w-[280px] p-0 shadow-xl"
        sideOffset={6}
      >
        <div className="px-3 pt-3 pb-2 border-b">
          <p className="text-xs font-semibold text-foreground">Choose connector app</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Assigns a visual identity to this node
          </p>
        </div>

        <ScrollArea className="h-[260px]">
          <div className="p-2 space-y-3">
            {CATEGORIES.map(({ key, label }) => {
              const icons = CONNECTOR_ICONS.filter((c) => c.category === key);
              return (
                <div key={key}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1 mb-1">
                    {label}
                  </p>
                  <div className="grid grid-cols-3 gap-1">
                    {icons.map((icon) => {
                      const isSelected = icon.id === currentId;
                      return (
                        <button
                          key={icon.id}
                          onClick={() => handleSelect(icon)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-md p-2",
                            "text-[10px] text-muted-foreground",
                            "hover:bg-accent hover:text-foreground",
                            "transition-colors duration-100",
                            "border border-transparent",
                            isSelected && "border-primary/40 bg-primary/5 text-foreground"
                          )}
                        >
                          <span
                            className={cn(
                              "w-7 h-7 rounded-md flex items-center justify-center",
                              icon.bgColor
                            )}
                          >
                            <icon.icon size={16} className={icon.color} />
                          </span>
                          <span className="truncate w-full text-center leading-tight">
                            {icon.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {current && (
          <div className="px-3 py-2 border-t flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <current.icon size={12} className={current.color} />
              <span className="text-xs text-muted-foreground">{current.label}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => updateNodeData(nodeId, { connectorIconId: undefined })}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}