"use client";

import { PencilLine } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceNameSchema } from "@/features/workspaces/contract";

import { useCloudSession, useCloudState } from "./cloud-context";

/**
 * Workspace name in the editor toolbar, renamable in place (I-06): Enter or leaving the field saves,
 * Escape cancels. Names are validated with the API's own schema before anything is sent.
 */
export function WorkspaceNameField() {
  const session = useCloudSession();
  const name = useCloudState((state) => state.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  const errorId = useId();

  useEffect(() => {
    document.title = `${name} · Artikin`;
  }, [name]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEditing() {
    closing.current = false;
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function stopEditing() {
    closing.current = true;
    setEditing(false);
    setError(null);
  }

  async function commit() {
    if (closing.current) return;
    const parsed = WorkspaceNameSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }
    stopEditing();
    const result = await session.rename(parsed.data);
    if (!result.ok) toast.error(result.message);
  }

  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="sm"
        data-testid="editor-workspace-name"
        aria-label={`Workspace “${name}” — rename`}
        title="Rename workspace"
        className="max-w-[12rem] justify-start font-medium xl:max-w-[16rem]"
        onClick={startEditing}
      >
        <span className="truncate">{name}</span>
        <PencilLine aria-hidden className="text-muted-foreground" />
      </Button>
    );
  }

  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        void commit();
      }}
    >
      <Input
        ref={inputRef}
        data-testid="editor-workspace-name-input"
        aria-label="Workspace name"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        spellCheck={false}
        value={draft}
        className="h-7 w-52 md:text-sm"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          stopEditing();
        }}
        onBlur={() => void commit()}
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          data-testid="editor-workspace-name-error"
          className="absolute top-full left-0 z-30 mt-1 w-max max-w-64 rounded-md border border-red-400/40 bg-popover px-2 py-1 text-xs text-red-300 shadow-lg"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
