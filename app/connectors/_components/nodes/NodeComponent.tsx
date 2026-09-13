import { NodeProps }     from "@xyflow/react";
import { memo }          from "react";
import NodeCard          from "./NodeCard";
import NodeHeader        from "./NodeHeader";
import { AppNodeData }   from "@/types/appNode";
import { TaskRegistry }  from "@/lib/connector/task/registry";
import { NodeInput, NodeInputs }   from "./NodeInputs";
import { NodeOutput, NodeOutputs } from "./NodeOutputs";

const NodeComponent = memo((props: NodeProps) => {
  const nodeData = props.data as AppNodeData;
  const task = TaskRegistry[nodeData.type as keyof typeof TaskRegistry];
  if (!task) {
    return null;
  }

  return (
    <NodeCard nodeId={props.id} isSelected={!!props.selected}>
      {/* NodeHeader now receives nodeId for the ConnectorIconPicker */}
      <NodeHeader taskType={nodeData.type} nodeId={props.id} />

      <NodeInputs>
        {task.inputs.map((input) => (
          <NodeInput key={input.name} input={input} nodeId={props.id} />
        ))}
      </NodeInputs>

      <NodeOutputs>
        {task.outputs.map((output) => (
          <NodeOutput key={output.name} output={output} />
        ))}
      </NodeOutputs>
    </NodeCard>
  );
});

NodeComponent.displayName = "NodeComponent";
export default NodeComponent;