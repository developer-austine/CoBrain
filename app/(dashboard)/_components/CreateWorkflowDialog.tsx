"use client"

import { useState, useTransition } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button }   from "@/components/ui/button"
import { Input }    from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label }    from "@/components/ui/label"
import { PlusIcon, Loader2 } from "lucide-react"
import { createWorkflow } from "@/actions/workflows/createWorkflow"
import { toast } from "sonner"

export default function CreateWorkflowDialog() {
  const [open, setOpen]            = useState(false)
  const [name, setName]            = useState("")
  const [desc, setDesc]            = useState("")
  const [pending, startTransition] = useTransition()

  const handleCreate = () => {
    if (!name.trim()) { toast.error("Workflow name is required"); return }
    startTransition(async () => {
      try {
        await createWorkflow({ name: name.trim(), description: desc.trim() })
        setOpen(false)
      } catch (err: any) {
        toast.error(err.message ?? "Failed to create workflow")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2"><PlusIcon size={15} />New Workflow</Button>} />

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Workflow</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wf-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="wf-name"
              placeholder="e.g. Gmail → Vector Store"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wf-desc">
              Description{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="wf-desc"
              placeholder="What does this workflow do?"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={pending || !name.trim()}>
            {pending && <Loader2 size={14} className="animate-spin mr-1.5" />}
            {pending ? "Creating…" : "Create & Open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}