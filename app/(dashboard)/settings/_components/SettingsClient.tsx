"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";
import { deleteAccount } from "@/actions/account/deleteAccount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Max avatar edge in px — keeps the stored data URL to a few KB. */
const AVATAR_SIZE = 128;

/** Downscale an image file to a square JPEG data URL suitable for an avatar. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  // Center-crop to a square, then scale down.
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE
  );
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function SettingsClient() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [savingAvatar, setSavingAvatar] = useState(false);
  const [name, setName] = useState<string | null>(null); // null = not edited yet
  const [savingName, setSavingName] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const user = session?.user;
  const displayName = name ?? user?.name ?? "";

  const pickAvatar = () => fileInputRef.current?.click();

  const onAvatarChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setSavingAvatar(true);
    try {
      const image = await fileToAvatarDataUrl(file);
      const { error } = await authClient.updateUser({ image });
      if (error) throw new Error(error.message);
      toast.success("Profile picture updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update picture");
    } finally {
      setSavingAvatar(false);
    }
  };

  const saveName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === user?.name) return;
    setSavingName(true);
    try {
      const { error } = await authClient.updateUser({ name: trimmed });
      if (error) throw new Error(error.message);
      toast.success("Name updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update name");
    } finally {
      setSavingName(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const result = await deleteAccount(password || undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Your account has been deleted");
      router.push("/sign-up");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto w-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your profile and account
        </p>
      </div>

      {/* ── Profile ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">Profile</h2>
          <p className="text-xs text-muted-foreground">
            Your picture and name, shown across the app.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-20 w-20 rounded-full overflow-hidden bg-linear-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-2xl font-semibold">
                {user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.image}
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (user?.name?.[0] || user?.email?.[0] || "U").toUpperCase()
                )}
              </div>
              <button
                onClick={pickAvatar}
                disabled={savingAvatar}
                title="Change picture"
                className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {savingAvatar ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Camera size={13} />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onAvatarChosen}
              />
            </div>
            <div className="sm:hidden">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          {/* Name + email */}
          <div className="flex-1 space-y-3">
            <div className="space-y-1">
              <label htmlFor="display-name" className="text-xs font-medium text-muted-foreground">
                Display name
              </label>
              <div className="flex gap-2">
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button
                  size="sm"
                  className="h-9"
                  onClick={saveName}
                  disabled={savingName || !displayName.trim() || displayName.trim() === user?.name}
                >
                  {savingName ? <Loader2 size={13} className="animate-spin" /> : "Save"}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Email</p>
              <p className="text-sm">{user?.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Danger zone ─────────────────────────────────────────────────────── */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="text-xs text-muted-foreground">
            Deleting your account removes your workflows, connections, synced
            documents, and chat history. This cannot be undone.
          </p>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="gap-2"
          >
            <Trash2 size={14} /> Delete my account
          </Button>
        </CardContent>
      </Card>

      {/* ── Delete confirmation (password-gated) ────────────────────────────── */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently erases your account and every piece of data tied
              to it. Enter your password to confirm (leave blank if you signed
              up with Google or GitHub).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={deleting}
            className="h-10"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
