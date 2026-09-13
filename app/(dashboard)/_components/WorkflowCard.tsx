"use client"

import { useState, useTransition } from "react"
import Link               from "next/link"
import { formatDistanceToNow } from "date-fns"
import {
  Card, CardContent, CardFooter, CardHeader,
} from "@/components/ui/card"
import { Badge }   from "@/components/ui/badge"
import { Button }  from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  GitBranchIcon, MoreVerticalIcon,
  PencilIcon, Trash2Icon, Loader2,
} from "lucide-react"
import { deleteWorkflow } from "@/actions/workflows/deleteWorkflow"
import ConfirmDialog from "@/components/ConfirmDialog"
import { toast } from "sonner"

interface WorkflowCardProps {
  id:          string
  name:        string
  description: string | null
  status:      string
  updatedAt:   Date
}

const statusColor: Record<string, string> = {
  draft:    "bg-muted text-muted-foreground",
  active:   "bg-green-500/15 text-green-600",
  archived: "bg-orange-500/15 text-orange-600",
}

export default function WorkflowCard({
  id, name, description, status, updatedAt,
}: WorkflowCardProps) {
  const [deleting, startDelete] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleDelete = () => {
    startDelete(async () => {
      try {
        await deleteWorkflow(id)
        toast.success("Workflow deleted")
        setConfirmOpen(false)
      } catch {
        toast.error("Failed to delete workflow")
      }
    })
  }

  return (
    <>
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={`Delete "${name}"?`}
      description="This permanently removes the workflow, its connections, and every synced document. This cannot be undone."
      confirmLabel="Delete workflow"
      loading={deleting}
      onConfirm={handleDelete}
    />
    <Card className="group flex flex-col justify-between hover:border-primary/50 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          {/* Icon + name */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <GitBranchIcon size={15} className="text-primary" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{name}</p>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 h-4 mt-0.5 font-normal ${statusColor[status] ?? ""}`}
              >
                {status}
              </Badge>
            </div>
          </div>

          {/* Actions menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
            render={
                <Button variant="ghost" size="icon" className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            }
            >
            <MoreVerticalIcon size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Link href={`/connectors/${id}`} className="flex items-center gap-2">
                  <PencilIcon size={13} /> Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive flex items-center gap-2"
                onClick={() => setConfirmOpen(true)}
                disabled={deleting}
              >
                {deleting
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Trash2Icon size={13} />}
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2.5rem]">
          {description || "No description"}
        </p>
      </CardContent>

      <CardFooter className="pt-0 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          Updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
        </span>
        <Button size="sm" variant="secondary" className="h-7 text-xs">
          <Link href={`/connectors/${id}`}>Open →</Link>
        </Button>
      </CardFooter>
    </Card>
    </>
  )
}