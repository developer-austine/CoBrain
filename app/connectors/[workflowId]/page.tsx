import React from 'react'
import Editor from '../_components/Editor'

async function page({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params

  return (
    <Editor workflowId={workflowId} />
  )
}

export default page