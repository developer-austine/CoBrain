"use server";

import { TaskRegistry } from "@/lib/connector/task/registry";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { createExecutionPlan } from "@/lib/workflow/executionPlan";
import {
    ExecutionPhaseStatus,
    WorkflowExecutionStatus,
    WorkflowExecutionTrigger,
} from "@/types/workflow";
import { getCurrentUserId } from "@/lib/get-session";
import { queueWorkflowDocuments } from "@/lib/queue/queueWorkflowDocuments";
import { recordIngestBatch } from "@/lib/metering/ingest";
import { redirect } from "next/navigation";

type PrismaType = typeof prisma;

export async function RunWorkflow(form: {
    workflowId: string;
    flowDefinition?: string;
}) {
    const userId = await getCurrentUserId();
    if (!userId) {
        throw new Error("Unauthenticated");
    }

    return withTenant(userId, async () => {
      const { workflowId, flowDefinition } = form;

      if (!workflowId) {
          throw new Error("WorkflowId is required");
      }

      const workflow = await prisma.workflow.findUnique({
          where: {
              userId,
              id: workflowId,
          },
      });

      if (!workflow) {
          throw new Error("Workflow not found");
      }

      if (!flowDefinition) {
          throw new Error("Flow definition is not defined");
      }

      const flow = JSON.parse(flowDefinition);

      const { executionPlan } = createExecutionPlan(flow.nodes, flow.edges);

      const plan = executionPlan ?? [];

      const execution = await prisma.workflowExecution.create({
      data: {
          workflowId,
          userId,
          status: WorkflowExecutionStatus.PENDING,
          startedAt: new Date(),
          trigger: WorkflowExecutionTrigger.MANUAL,
          executionPhases: {
              create: plan.flatMap((phase) =>
                  phase.nodes.flatMap((node) => ({
                      userId,
                      status: ExecutionPhaseStatus.CREATED,
                      number: phase.phase,
                      node: JSON.stringify(node),
                      name: TaskRegistry[node.data.type as keyof typeof TaskRegistry].label,
                  }))
              ),
          },
      },
      select: {
          id: true,
          executionPhases: true,
      },
      });

      if (!execution) {
          throw new Error("Workflow execution not created");
      }

      // Queue this workflow's PENDING documents onto the Redis ingest queue so
      // the Python pipeline (normalize -> PII -> chunk -> embed -> Qdrant)
      // actually processes them. Without this, Execute only records phases.
      const queued = await queueWorkflowDocuments(workflowId, userId);
      console.log(
          `[RunWorkflow] queued ${queued.total} documents ` +
          `(gmail=${queued.emails}, github=${queued.github}, notion=${queued.notion}, custom=${queued.custom})`
      );

      // Metering. Records the full volume against the plan's included ingest
      // allowance and charges only the excess — a normal-sized sync costs
      // nothing. Keyed on the execution id, so a retried run of the same
      // execution neither double-counts the allowance nor double-charges.
      //
      // Deliberately non-fatal: the documents are already on the queue and the
      // pipeline will process them, so failing the run here would leave the
      // work done and the user staring at an error.
      try {
          const { billedDocuments } = await recordIngestBatch({
              tenantId: userId,
              actorUserId: userId,
              batchId: `execution:${execution.id}`,
              documentCount: queued.total,
              source: "workflow",
          });
          if (billedDocuments > 0) {
              console.log(`[RunWorkflow] metered ${billedDocuments} documents above the included volume`);
          }
      } catch (err) {
          console.error("[RunWorkflow] ingest metering failed:", err);
      }

      redirect(`/connectors/runs/${workflowId}/${execution.id}`)
    });
}