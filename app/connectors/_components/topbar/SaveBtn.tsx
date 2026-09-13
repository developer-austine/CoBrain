"use client"

import { RunWorkflow } from '@/actions/workflows/runWorkflow'
import { UpdateWorkflow } from '@/actions/workflows/updateWorkflow'
import { Button } from '@/components/ui/button'
import { useMutation } from "@tanstack/react-query"
import { useReactFlow } from '@xyflow/react'
import { CheckIcon, Send } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'

function SaveBtn({ workflowId }: { workflowId: string }) {
    const { toObject } = useReactFlow();

    const saveMutation = useMutation({
        mutationFn: UpdateWorkflow,
        onSuccess: () => toast.success("Flow saved successfully", { id: "save-workflow" }),
        onError: () => toast.error("Something went wrong. Please try again", { id: "save-workflow" }),
    });

    const runMutation = useMutation({
        mutationFn: RunWorkflow,
        onSuccess: () => toast.success("Execution started", { id: "run-workflow" }),
        onError: (e) => toast.error(e.message || "Failed to run workflow", { id: "run-workflow" }),
    });

    return (
        <div className="flex items-center justify-between gap-2">
            <Button
                variant={"outline"}
                className="flex items-center gap-2"
                disabled={runMutation.isPending}
                onClick={() => {
                    const flowDefinition = JSON.stringify(toObject());
                    toast.loading("Starting execution...", { id: "run-workflow" });
                    runMutation.mutate({ workflowId, flowDefinition });
                }}
            >
                <Send size={16} className='stroke-green-400' />
                Execute
            </Button>

            <Button
                variant={"outline"}
                className="flex items-center gap-2"
                onClick={() => {
                    const workflowDefinition = JSON.stringify(toObject());
                    toast.loading("Saving workflow...", { id: "save-workflow" });
                    saveMutation.mutate({ id: workflowId, definition: workflowDefinition });
                }}
            >
                <CheckIcon size={16} className='stroke-green-400' />
                Save
            </Button>
        </div>
    );
}

export default SaveBtn;