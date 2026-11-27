"use client";

import { CloudUpload, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { workspaceApi } from "@/features/workspaces/api-client";
import { hasAuthHint } from "@/lib/auth/auth-hint";
import { DEFAULT_MAX_WORKSPACES_PER_USER } from "@/lib/config";

import type { EditorSlots } from "../editor-app";
import { EditorLoader } from "../editor-loader";
import { useEditor } from "../store/context";
import type { EditorStore } from "../store/editor-store";
import {
  type DraftWriteError,
  clearGuestDraft,
  getGuestDraftWriteError,
  parseGuestDraft,
  readGuestDraftText,
  writeGuestDraft,
} from "./guest-draft";
import { GuestImport, type GuestImportNotice, rememberImportIntent } from "./guest-import";
import { GuestImportProvider, useGuestImport, useGuestImportState } from "./guest-import-context";
import { ReplaceWorkspaceDialog, SIGN_UP_TO_IMPORT_HREF, SaveToCloudDialog } from "./guest-import-dialogs";
import { runWhenIdle } from "./interaction";
import { SaveStatusBadge } from "./save-status";
import { renderThumbnail } from "./thumbnail";

const DRAFT_ERRORS: Record<DraftWriteError, string> = {
  quota: "This browser's storage is full, so your draft isn't being kept. Save to cloud or export to keep your work.",
  unavailable: "This browser doesn't allow keeping the draft (storage is blocked). Save to cloud or export to keep your work.",
  "too-large": "This scene is too large to keep as a draft. Save to cloud or export to keep your work.",
};

function showNotice({ tone, message }: GuestImportNotice) {
  if (tone === "error") toast.error(message);
  else if (tone === "success") toast.success(message);
  else toast(message);
}

/** Signed in? Anonymous guests (no auth hint cookie, FT-02) are answered without a request. */
export async function isSignedIn(): Promise<boolean> {
  if (!hasAuthHint(document.cookie)) return false;
  const { authClient } = await import("@/lib/auth/auth-client");
  const { data } = await authClient.getSession();
  return Boolean(data?.user);
}

/** Guest toolbar slot: the draft's save status (re-renders only when the status changes). */
export function GuestToolbarLeading() {
  const status = useEditor((state) => state.persistence.status);
  const writeError = status === "error" ? getGuestDraftWriteError() : null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="hidden truncate text-sm text-muted-foreground lg:inline">Guest draft</span>
      <SaveStatusBadge
        mode="guest"
        status={status}
        detail={writeError ? DRAFT_ERRORS[writeError] : "Your scene is kept in this browser"}
      />
    </div>
  );
}

function SaveToCloudButton() {
  const flow = useGuestImport();
  const phase = useGuestImportState((state) => state.phase);
  const busy = phase === "checking" || phase === "saving" || phase === "replacing" || phase === "done";
  const label = busy ? "Saving to cloud…" : "Save to cloud";
  return (
    <Button
      size="sm"
      data-testid="guest-save-to-cloud"
      aria-label={label}
      title="Save this scene as a workspace in your account"
      disabled={busy}
      onClick={() => void flow.start()}
    >
      {busy ? <Loader2 aria-hidden className="animate-spin" /> : <CloudUpload aria-hidden />}
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}

function GuestNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      data-testid="guest-banner"
      role="note"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-foreground/90"
    >
      <span>
        You&apos;re editing as a guest — your scene is kept in this browser.{" "}
        <Link
          href={SIGN_UP_TO_IMPORT_HREF}
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => rememberImportIntent()}
        >
          Sign up
        </Link>{" "}
        to save up to {DEFAULT_MAX_WORKSPACES_PER_USER} workspaces.
      </span>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <X />
      </Button>
    </div>
  );
}

const GUEST_SLOTS: EditorSlots = {
  toolbarLeading: <GuestToolbarLeading />,
  toolbarTrailing: <SaveToCloudButton />,
  banner: <GuestNotice />,
  overlays: (
    <>
      <SaveToCloudDialog />
      <ReplaceWorkspaceDialog />
    </>
  ),
};

/** Reports drafts that couldn't be restored and draft writes that fail (once per failure streak). */
function watchDraft(store: EditorStore): () => void {
  // The editor already restored (or rejected) the draft; finding out why can wait for an idle moment.
  const text = readGuestDraftText();
  const cancelCheck =
    text === null
      ? () => undefined
      : runWhenIdle(() => {
          if (parseGuestDraft(text).status === "invalid") {
            toast.warning("Your saved draft couldn't be restored, so a new scene was started.", { id: "guest-draft-invalid" });
          }
        }, 2_000);
  let failing = store.getState().persistence.status === "error";
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.persistence === prev.persistence) return;
    const nowFailing = state.persistence.status === "error";
    if (nowFailing && !failing) {
      const reason = getGuestDraftWriteError();
      if (reason) toast.error(DRAFT_ERRORS[reason], { id: "guest-draft-error" });
    }
    failing = nowFailing;
  });
  return () => {
    cancelCheck();
    unsubscribe();
  };
}

/**
 * Guest editor (PROJECT F13, I-05): S2's editor in guest mode (browser draft) plus "Save to cloud",
 * the sign-up notice and the import dialogs, attached through `onStoreReady` and the editor slots.
 */
export function GuestEditor() {
  const router = useRouter();
  const [flow] = useState(
    () =>
      new GuestImport({
        api: workspaceApi,
        isSignedIn,
        navigate: (href) => router.replace(href),
        saveDraft: (scene) => void writeGuestDraft(scene),
        clearDraft: () => clearGuestDraft({ lock: true }),
        makeThumbnail: (store) => {
          const capture = store.getState().engine.capture;
          return capture ? renderThumbnail(capture) : Promise.resolve(null);
        },
        notify: showNotice,
      }),
  );
  const onStoreReady = useCallback(
    (store: EditorStore) => {
      const detachFlow = flow.attach(store);
      const stopWatching = watchDraft(store);
      return () => {
        stopWatching();
        detachFlow();
      };
    },
    [flow],
  );

  return (
    <GuestImportProvider value={flow}>
      <EditorLoader mode="guest" onStoreReady={onStoreReady} slots={GUEST_SLOTS} />
    </GuestImportProvider>
  );
}
