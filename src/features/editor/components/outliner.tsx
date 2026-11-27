"use client";

import { Copy, Eye, EyeOff, Lightbulb, Lock, LockOpen, MoreHorizontal, Pencil, PersonStanding, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MAX_LIGHTS_PER_SCENE, MAX_MANNEQUINS_PER_SCENE } from "@/lib/config";
import { useEditor, useEditorStore } from "../store/context";
import { SectionTitle } from "./fields";

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Input
      autoFocus
      data-testid="outliner-name-input"
      aria-label="New name"
      maxLength={40}
      className="h-7 text-sm"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value);
        if (e.key === "Escape") onDone(null);
      }}
    />
  );
}

function Row({
  id,
  kind,
  name,
  selected,
  visible,
  locked,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onRename,
  onDuplicate,
  onDelete,
}: {
  id: string;
  kind: "figure" | "light";
  name: string;
  selected: boolean;
  visible: boolean;
  locked?: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleLock?: () => void;
  onRename: (name: string) => void;
  onDuplicate?: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const pendingRename = useRef(false);
  const Icon = kind === "figure" ? PersonStanding : Lightbulb;
  return (
    <li
      data-testid="outliner-item"
      data-id={id}
      data-kind={kind}
      data-selected={selected ? "true" : "false"}
      className={`group flex items-center gap-1 rounded-md px-1 py-0.5 ${selected ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-muted/60"}`}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {renaming ? (
        <RenameInput
          initial={name}
          onDone={(v) => {
            setRenaming(false);
            if (v !== null && v.trim()) onRename(v);
          }}
        />
      ) : (
        <button
          type="button"
          className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${visible ? "" : "text-muted-foreground line-through"}`}
          aria-current={selected ? "true" : undefined}
          onClick={onSelect}
          onDoubleClick={() => setRenaming(true)}
        >
          {name}
        </button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        data-testid="outliner-item-visibility"
        aria-pressed={!visible}
        aria-label={visible ? `Hide ${name}` : `Show ${name}`}
        onClick={onToggleVisible}
      >
        {visible ? <Eye /> : <EyeOff />}
      </Button>
      {onToggleLock && (
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="outliner-item-lock"
          aria-pressed={!!locked}
          aria-label={locked ? `Unlock ${name}` : `Lock ${name}`}
          className={locked ? "text-amber-300" : ""}
          onClick={onToggleLock}
        >
          {locked ? <Lock /> : <LockOpen />}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" data-testid="outliner-item-menu" aria-label={`More actions for ${name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // "Rename" opens the name field once the menu has closed, and keeps the focus there instead
          // of returning it to the menu trigger.
          onCloseAutoFocus={(event) => {
            if (!pendingRename.current) return;
            pendingRename.current = false;
            event.preventDefault();
            setRenaming(true);
          }}
        >
          <DropdownMenuItem
            data-testid="outliner-rename"
            onSelect={() => {
              pendingRename.current = true;
            }}
          >
            <Pencil /> Rename
          </DropdownMenuItem>
          {onDuplicate && (
            <DropdownMenuItem data-testid="outliner-duplicate" onSelect={onDuplicate}>
              <Copy /> Duplicate
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="outliner-delete" variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

interface FigureRow {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

interface LightRow {
  id: string;
  name: string;
  visible: boolean;
}

export function Outliner() {
  const store = useEditorStore();
  // Only what the rows show, as stable strings: pose and light edits (every drag frame) and other
  // unrelated scene changes must not re-render the list.
  const figureKey = useEditor((s) => JSON.stringify(s.scene.mannequins.map((m) => [m.id, m.name, m.visible, m.locked])));
  const lightKey = useEditor((s) => JSON.stringify(s.scene.lights.map((l) => [l.id, l.name, l.visible])));
  const mannequins = useMemo(
    () => (JSON.parse(figureKey) as [string, string, boolean, boolean][]).map(([id, name, visible, locked]): FigureRow => ({ id, name, visible, locked })),
    [figureKey],
  );
  const lights = useMemo(
    () => (JSON.parse(lightKey) as [string, string, boolean][]).map(([id, name, visible]): LightRow => ({ id, name, visible })),
    [lightKey],
  );
  const selection = useEditor((s) => s.selection);
  const s = () => store.getState();
  const selectedFigure = selection.kind === "bone" || selection.kind === "mannequin" ? selection.mannequinId : null;

  return (
    <aside data-testid="outliner" aria-label="Scene outliner" className="flex h-full min-h-0 flex-col border-r border-border bg-card/60">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          <div className="flex flex-col gap-1.5">
            <SectionTitle>
              Figures {mannequins.length}/{MAX_MANNEQUINS_PER_SCENE}
            </SectionTitle>
            <ul className="flex flex-col gap-0.5">
              {mannequins.map((m) => (
                <Row
                  key={m.id}
                  id={m.id}
                  kind="figure"
                  name={m.name}
                  selected={selectedFigure === m.id}
                  visible={m.visible}
                  locked={m.locked}
                  onSelect={() => s().select({ kind: "mannequin", mannequinId: m.id })}
                  onToggleVisible={() => s().setMannequinVisible(m.id, !m.visible)}
                  onToggleLock={() => s().setMannequinLocked(m.id, !m.locked)}
                  onRename={(name) => s().renameMannequin(m.id, name)}
                  onDuplicate={() => s().duplicateMannequin(m.id)}
                  onDelete={() => s().removeMannequin(m.id)}
                />
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <SectionTitle>
              Lights {lights.length}/{MAX_LIGHTS_PER_SCENE}
            </SectionTitle>
            <ul className="flex flex-col gap-0.5">
              {lights.map((l) => (
                <Row
                  key={l.id}
                  id={l.id}
                  kind="light"
                  name={l.name}
                  selected={selection.kind === "light" && selection.lightId === l.id}
                  visible={l.visible}
                  onSelect={() => s().select({ kind: "light", lightId: l.id })}
                  onToggleVisible={() => s().updateLight(l.id, { visible: !l.visible })}
                  onRename={(name) => s().updateLight(l.id, { name })}
                  onDelete={() => s().removeLight(l.id)}
                />
              ))}
            </ul>
          </div>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => s().clearSelection()}>
            Scene settings
          </Button>
        </div>
      </ScrollArea>
    </aside>
  );
}
