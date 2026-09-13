"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  UploadCloudIcon,
  FileTextIcon,
  Trash2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
  ClockIcon,
  HardDriveIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_SUMMARY,
  MAX_UPLOAD_BYTES,
  humanFileSize,
  validateUpload,
} from "@/lib/sources/constants";
import {
  deleteUploadedSource,
  listUploadedSources,
  type UploadedSource,
} from "@/actions/sources/sources";

type Props = {
  initialUploaded: UploadedSource[];
  storageReachable: boolean;
};

const STATUS_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; className: string }
> = {
  PENDING: {
    label: "Uploading",
    icon: ClockIcon,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  QUEUED: {
    label: "Processing",
    icon: Loader2Icon,
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
  },
  PROCESSED: {
    label: "Searchable",
    icon: CheckCircle2Icon,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  FAILED: {
    label: "Failed",
    icon: AlertCircleIcon,
    className: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
  },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;
  const Icon = meta.icon;
  const spin = status === "QUEUED" || status === "PENDING";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        meta.className
      )}
    >
      <Icon size={13} className={spin ? "animate-spin" : ""} />
      {meta.label}
    </span>
  );
}

export default function SourcesClient({
  initialUploaded,
  storageReachable,
}: Props) {
  const [uploaded, setUploaded] = useState<UploadedSource[]>(initialUploaded);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Refresh the list from the server (used after upload + for status polling).
  // We use startTransition to avoid blocking the UI while fetching the list of uploaded sources. This allows the user to continue interacting with the page while the list is being updated in the background.
  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const rows = await listUploadedSources();
        setUploaded(rows);
      } catch {
        /* transient — next poll retries */
      }
    });
  }, []);

  // Poll while anything is still working its way through the pipeline.
  const hasPending = uploaded.some(
    (u) => u.status === "PENDING" || u.status === "QUEUED"
  );
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [hasPending, refresh]);

  const uploadOne = useCallback(
    async (file: File) => {
      const check = validateUpload(file.name, file.type, file.size);
      if (!check.ok) {
        toast.error(`${file.name}: ${check.reason}`);
        return;
      }
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/sources/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        toast.error(`${file.name}: ${msg?.error || "upload failed"}`);
        return;
      }
      toast.success(`${file.name} uploaded — processing now`);
    },
    []
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(true);
      try {
        for (const f of list) await uploadOne(f);
        refresh();
      } finally {
        setUploading(false);
      }
    },
    [uploadOne, refresh]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onDelete = useCallback((id: string, name: string) => {
    // optimistic
    setUploaded((prev) => prev.filter((u) => u.id !== id));
    startTransition(async () => {
      const ok = await deleteUploadedSource(id).catch(() => false);
      if (ok) toast.success(`Removed ${name}`);
      else {
        toast.error(`Couldn't remove ${name}`);
        listUploadedSources().then(setUploaded).catch(() => {});
      }
    });
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Sources
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload documents into your Brain. Once processed they become
            searchable and citable in chat, alongside your connected sources.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            storageReachable
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
          title={
            storageReachable
              ? "Object storage is online — uploads are stored in your own stack."
              : "Object storage is unreachable — start the MinIO service to enable uploads."
          }
        >
          <HardDriveIcon size={13} />
          {storageReachable ? "Storage online" : "Storage offline"}
        </span>
      </div>

      {/* Upload dropzone */}
      <section>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "group relative flex aspect-16/7 w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all",
            dragOver
              ? "border-emerald-500 bg-emerald-500/5 scale-[1.01]"
              : "border-border hover:border-emerald-500/50 hover:bg-emerald-500/3"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-2xl transition-colors",
              dragOver
                ? "bg-emerald-500 text-white"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500/15"
            )}
          >
            {uploading ? (
              <Loader2Icon size={30} className="animate-spin" />
            ) : (
              <UploadCloudIcon size={30} />
            )}
          </div>
          <p className="mt-4 text-base font-medium text-foreground">
            {uploading
              ? "Uploading…"
              : dragOver
                ? "Drop to upload"
                : "Drag files here, or click to browse"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{ACCEPTED_SUMMARY}</p>
          <p className="mt-3 text-xs text-muted-foreground/70">
            Files are stored in your own stack and processed through the same
            pipeline as your connectors — up to {humanFileSize(MAX_UPLOAD_BYTES)}{" "}
            each.
          </p>
        </div>
      </section>

      {/* Uploaded files list */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
            Uploaded files
          </h2>
          {uploaded.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {uploaded.length} file{uploaded.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {uploaded.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
            <FileTextIcon
              size={28}
              className="mx-auto text-muted-foreground/40"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              No uploads yet. Drop a document above to add it to your Brain.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {uploaded.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 p-3.5 sm:px-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <FileTextIcon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {f.fileName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {humanFileSize(f.sizeBytes)}
                    {f.extractedChars != null &&
                      ` · ${f.extractedChars.toLocaleString()} chars indexed`}
                    {f.status === "FAILED" && f.errorMessage
                      ? ` · ${f.errorMessage}`
                      : ""}
                  </p>
                </div>
                <StatusBadge status={f.status} />
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    render={
                      <a
                        href={`/api/sources/${f.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="View file"
                  >
                    <ExternalLinkIcon size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                    title="Remove file"
                    onClick={() => onDelete(f.id, f.fileName)}
                  >
                    <Trash2Icon size={16} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
