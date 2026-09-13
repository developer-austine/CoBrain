"use client"

import { ReactFlowProvider }   from "@xyflow/react"
import FlowEditor              from './FlowEditor'
import Topbar                  from './topbar/Topbar'
import TaskMenu                from './TaskMenu'
import { WorkflowProvider }    from './WorkflowContext'
import { useEffect, useState } from "react"
import { Loader2 }             from "lucide-react"

function Editor({ workflowId }: { workflowId: string }) {
  const [definition, setDefinition] = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    fetch(`/api/workflow/${workflowId}`)
      .then(r => r.json())
      .then(data => {
        setDefinition(data.definition ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [workflowId])

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    )
  }

  return (
    <WorkflowProvider id={workflowId}>
      <ReactFlowProvider>
        <div className="flex flex-col h-full w-full overflow-hidden">
          <Topbar title="Workflow Editor" workflowId={workflowId} />
          <section className="flex h-full overflow-hidden">
            <TaskMenu />
            <FlowEditor initialDefinition={definition} />
          </section>
        </div>
      </ReactFlowProvider>
    </WorkflowProvider>
  )
}

export default Editor