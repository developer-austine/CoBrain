import { AppNode, AppNodeMissingInputs } from "@/types/appNode";
import { WorkflowExecutionPlan, WorkflowExecutionPlanPhase, WorkflowTask } from "@/types/workflow";
import { TaskRegistry } from "@/lib/connector/task/registry";
import { TaskParamType } from "@/types/task";
import { Edge } from "@xyflow/react";

export enum FlowToExecutionPlanValidationError {
    NO_ENTRY_POINT = "NO_ENTRY_POINT",
    INVALID_INPUTS = "INVALID_INPUTS",
}

type FlowToExecutionPlanType = {
    executionPlan?: WorkflowExecutionPlan;
    error?: {
        type: FlowToExecutionPlanValidationError;
        invalidElements?: AppNodeMissingInputs[];
    };
};

export function createExecutionPlan(
    nodes: AppNode[],
    edges: Edge[]
): FlowToExecutionPlanType {
    const entryPoint = nodes.find(
        (node) => TaskRegistry[node.data.type as keyof typeof TaskRegistry]?.isEntryPoint
    );

    if (!entryPoint) {
        return {
            error: {
                type: FlowToExecutionPlanValidationError.NO_ENTRY_POINT,
            },
        };
    }

    const inputsWithErrors: AppNodeMissingInputs[] = [];
    const planned = new Set<string>();
    const executionPlan: WorkflowExecutionPlan = [];

    const invalidInputs = getInvalidInputs(entryPoint, edges, planned);
    if (invalidInputs.length > 0) {
        inputsWithErrors.push({ nodeId: entryPoint.id, inputs: invalidInputs });
    }

    executionPlan.push({ phase: 1, nodes: [entryPoint] });
    planned.add(entryPoint.id);

    for (
        let phase = 2;
        phase <= nodes.length && planned.size < nodes.length;
        phase++
    ) {
        const nextPhaseNodes: AppNode[] = [];

        for (const node of nodes) {
            if (planned.has(node.id)) continue;

            const invalidInputs = getInvalidInputs(node, edges, planned);

            if (invalidInputs.length > 0) {
                const nodeHasUnresolvedDeps = getIncomingEdges(node.id, edges).filter(
                    (edge) => !planned.has(edge.source)
                ).length > 0;

                if (!nodeHasUnresolvedDeps) {
                    inputsWithErrors.push({ nodeId: node.id, inputs: invalidInputs });
                }
                continue;
            }

            nextPhaseNodes.push(node);
        }

        for (const node of nextPhaseNodes) {
            planned.add(node.id);
        }

        if (nextPhaseNodes.length > 0) {
            executionPlan.push({ phase, nodes: nextPhaseNodes });
        }
    }

    if (inputsWithErrors.length > 0) {
        return {
            error: {
                type: FlowToExecutionPlanValidationError.INVALID_INPUTS,
                invalidElements: inputsWithErrors,
            },
        };
    }

    return { executionPlan };
}

function getIncomingEdges(nodeId: string, edges: Edge[]): Edge[] {
    return edges.filter((edge) => edge.target === nodeId);
}

function getInvalidInputs(
    node: AppNode,
    edges: Edge[],
    planned: Set<string>
): string[] {
    const invalidInputs: string[] = [];
    const task: WorkflowTask =
        TaskRegistry[node.data.type as keyof typeof TaskRegistry];

    for (const input of task.inputs) {
        const inputValue = node.data.inputs?.[input.name];
        const inputValueProvided = inputValue?.length > 0;

        if (inputValueProvided) continue;

        const incomingEdges = getIncomingEdges(node.id, edges);
        const inputLinkedToOutput = incomingEdges.find(
            (edge) => edge.targetHandle === input.name
        );

        const requiredInputProvidedByVisitedOutput =
            input.required &&
            inputLinkedToOutput &&
            planned.has(inputLinkedToOutput.source);

        if (requiredInputProvidedByVisitedOutput) continue;

        if (input.required && !inputLinkedToOutput) {
            invalidInputs.push(input.name);
        }
    }

    return invalidInputs;
}