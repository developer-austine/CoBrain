"use client"

import {
  ReactFlow, useEdgesState, useNodesState,
  Background, BackgroundVariant, Controls,
  useReactFlow, Connection, addEdge, Edge,
} from "@xyflow/react"
import React, { useCallback, useMemo } from "react"
import "@xyflow/react/dist/style.css"
import { CreateFlowNode }      from "@/lib/connector/createFlowNode"
import { createDefaultPipeline } from "@/lib/connector/createDefaultPipeline"
import { TaskType }            from "@/types/task"
import NodeComponent           from "./nodes/NodeComponent"
import { AppNode }             from "@/types/appNode"
import DeletableEdge           from "./edges/DeletableEdge"

const nodeTypes      = { ConnectorNode: NodeComponent }
const edgeTypes      = { default: DeletableEdge }
const snapGrid: [number, number] = [50, 50]
const fitViewOptions = { padding: 1 }

function parseDefinition(definition: string | null): {
  nodes: AppNode[] | null;
  edges: Edge[]   | null;
} {
  if (!definition) return { nodes: null, edges: null };
  try {
    const parsed = JSON.parse(definition);
    return {
      nodes: parsed.nodes?.length ? (parsed.nodes as AppNode[]) : null,
      edges: (parsed.edges as Edge[]) ?? [],
    };
  } catch {
    return { nodes: null, edges: null };
  }
}

interface FlowEditorProps {
  initialDefinition: string | null;
}

function FlowEditor({ initialDefinition }: FlowEditorProps) {
  const { nodes: savedNodes, edges: savedEdges } = parseDefinition(initialDefinition);

  // For a new/empty workflow, start from the pre-connected core pipeline so the
  // user only has to attach a source to the Normalizer. Computed once so the
  // nodes and their edges reference the same generated node ids.
  const defaultPipeline = useMemo(() => createDefaultPipeline(), []);

  // ── Initialise from DB definition, or the default pre-built pipeline ──────
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(
    savedNodes ?? defaultPipeline.nodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    savedNodes ? (savedEdges ?? []) : defaultPipeline.edges
  );

  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const taskType = event.dataTransfer.getData("application/reactflow");
    if (!taskType) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const newNode  = CreateFlowNode(taskType as TaskType, position);
    setNodes(nds => nds.concat(newNode));
  }, [screenToFlowPosition, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({ ...connection, animated: true }, eds));
  }, [setEdges]);

  return (
    <main className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        snapToGrid
        snapGrid={snapGrid}
        fitViewOptions={fitViewOptions}
        fitView
        onDragOver={onDragOver}
        onDrop={onDrop}
        onConnect={onConnect}
      >
        <Controls position="top-left" fitViewOptions={fitViewOptions} />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
      </ReactFlow>
    </main>
  );
}

export default FlowEditor;