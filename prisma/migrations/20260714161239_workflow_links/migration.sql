-- CreateTable
CREATE TABLE "WorkflowLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceWorkflowId" TEXT NOT NULL,
    "targetWorkflowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowLink_userId_idx" ON "WorkflowLink"("userId");

-- CreateIndex
CREATE INDEX "WorkflowLink_targetWorkflowId_idx" ON "WorkflowLink"("targetWorkflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowLink_sourceWorkflowId_targetWorkflowId_key" ON "WorkflowLink"("sourceWorkflowId", "targetWorkflowId");

-- AddForeignKey
ALTER TABLE "WorkflowLink" ADD CONSTRAINT "WorkflowLink_sourceWorkflowId_fkey" FOREIGN KEY ("sourceWorkflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLink" ADD CONSTRAINT "WorkflowLink_targetWorkflowId_fkey" FOREIGN KEY ("targetWorkflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
