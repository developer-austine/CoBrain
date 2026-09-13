import React from 'react'
import Editor from '../_components/Editor'

function page({workflowId}: {workflowId: string}) {
  return (
    <Editor workflowId={workflowId} />
  )
}

export default page