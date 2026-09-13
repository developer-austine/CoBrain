import { getWorkflows }           from "@/actions/workflows/getWorkflows"
import { listWorkflowLinks }      from "@/actions/workflows/workflowLinks"
import { listUploadedSources }    from "@/actions/sources/sources"
import { GitBranchIcon }           from "lucide-react"
import CreateWorkflowDialog from "../_components/CreateWorkflowDialog"
import WorkflowCard from "../_components/WorkflowCard"
import { KnowledgeFlow } from "../_components/KnowledgeFlow"

// Onboarding gating happens in the (dashboard) layout via requireOnboarded().
export default async function HomePage() {
  const [workflows, links, uploads] = await Promise.all([
    getWorkflows(),
    listWorkflowLinks(),
    listUploadedSources(),
  ])

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Build and manage your data connector pipelines
          </p>
        </div>
        <CreateWorkflowDialog />
      </div>

      {workflows.length === 0 ? (

        <div className="flex flex-col items-center justify-center gap-4 py-24 border-2 border-dashed rounded-xl text-center">
          <span className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <GitBranchIcon size={24} className="text-muted-foreground" />
          </span>
          <div>
            <p className="font-semibold">No workflows yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first workflow to start connecting data sources
            </p>
          </div>
          <CreateWorkflowDialog />
        </div>

      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                id={wf.id}
                name={wf.name}
                description={wf.description ?? null}
                status={wf.status}
                updatedAt={wf.updatedAt}
              />
            ))}
          </div>

          {/* How knowledge moves between workflows + the shared upload source. */}
          <KnowledgeFlow
            workflows={workflows.map((w) => ({ id: w.id, name: w.name }))}
            links={links}
            uploadCount={uploads.length}
          />
        </>
      )}
    </div>
  )
}