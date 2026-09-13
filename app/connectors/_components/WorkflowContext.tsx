"use client"

import { createContext, useContext } from "react"

const WorkflowContext = createContext<string>("")

export function WorkflowProvider({ id, children }: { 
  id: string
  children: React.ReactNode 
}) {
  return (
    <WorkflowContext.Provider value={id}>
      {children}
    </WorkflowContext.Provider>
  )
}

export function useWorkflowId() {
  return useContext(WorkflowContext)
}