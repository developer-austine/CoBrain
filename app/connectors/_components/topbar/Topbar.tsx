"use client"

import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"
import React from 'react'
import SaveBtn from "./SaveBtn"
import { useRouter } from "next/navigation"
// import ExecuteBtn from "./ExecuteBtn"
// import { TooltipWrapper } from "@/components/ui/tooltip"

interface Props {
    title: string;
    workflowId: string
}

function Topbar({title, workflowId}: Props) {
   const router  = useRouter();
  return (
    <header className='flex p-2 border-b-2 border-separate justify-between w-full h-[60px] sticky top-0 bg-background z-10'>
        <div className="flex gap-1 flex-1">
            {/* <TooltipWrapper content="Back"> */}
                <Button variant={"ghost"} size={"icon"} onClick={() => router.back()}>
                    <ChevronLeft size={20} />
                </Button>
            {/* </TooltipWrapper> */}
            <div className="">
                <p className="font-bold text-ellipsis">{title}</p>
            </div>
        </div>
        <div className="flex gap-1 flex-1 justify-end">
        </div>
        <div className="flex gap-1 flex-1 justify-end">
            <SaveBtn workflowId={workflowId} />
        </div>
    </header>
  )
}

export default Topbar