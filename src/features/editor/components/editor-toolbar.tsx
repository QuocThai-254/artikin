"use client";

import {
  ChevronDown,
  CircleHelp,
  Download,
  Ellipsis,
  Hand,
  Lightbulb,
  ListTree,
  Lock,
  LockOpen,
  Move3d,
  Redo2,
  Rotate3d,
  SlidersHorizontal,
  Undo2,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useStore } from "zustand";

import { Lockup, Mark } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_LIGHTS_PER_SCENE } from "@/lib/config";
import { useEditor, useEditorStore } from "../store/context";
import type { Tool } from "../store/editor-store";
import { isMasterLocked, lockSummary } from "../store/guards";

/*
 * Responsive layout (PROJECT §13.1). Everything is inline from `md` up. Below `md` the secondary
 * actions (add figure/light, shortcuts) move into the "More" menu; below `sm` (phones) the three
 * tools collapse into a dropdown and Export and the lock options join the More menu; below 375 px the
 * logo hides and below 340 px Redo moves into the menu. The lock badge shows from `xl`. The inline
 * controls keep their test ids at every width; the menu copies use `toolbar-more-*` and
 * `toolbar-tool-menu-*` ids (rendered only while the menu is open, so ids never clash).
 */

const TOOLS: { tool: Tool; label: string; key: string; Icon: typeof Rotate3d }[] = [
  { tool: "rotate", label: "Rotate joints", key: "R", Icon: Rotate3d },
  { tool: "drag", label: "Drag hands & feet", key: "G", Icon: Hand },
  { tool: "move", label: "Move figure", key: "M", Icon: Move3d },
];

function IconButton({
  label,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? ` (${shortcut})` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function useCanAddLight() {
  const lightCount = useEditor((s) => s.scene.lights.length);
  const lightsLocked = useEditor((s) => s.scene.lock.lights);
  return { full: lightCount >= MAX_LIGHTS_PER_SCENE, enabled: lightCount < MAX_LIGHTS_PER_SCENE && !lightsLocked };
}

export function LockControl() {
  const store = useEditorStore();
  const lock = useEditor((s) => s.scene.lock);
  const master = isMasterLocked(lock);
  const any = lock.pose || lock.lights || lock.view;
  return (
    <div className="flex shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={any ? "secondary" : "ghost"}
            size="sm"
            data-testid="toolbar-lock"
            aria-pressed={master}
            aria-label={master ? "Unlock pose, lights and view" : "Lock pose, lights and view"}
            className={`sm:rounded-r-none ${any ? "text-amber-300" : ""}`}
            onClick={() => store.getState().toggleMasterLock()}
          >
            {any ? <Lock /> : <LockOpen />}
            {/* When locked, the `lock-badge` next to it (xl) names what is locked. */}
            {!any && <span className="hidden xl:inline">Lock</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{master ? "Unlock pose, lights and view (L)" : "Lock pose, lights and view (L)"}</TooltipContent>
      </Tooltip>
      {/* Phones: the pose/lights/view options live in the More menu. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden rounded-l-none sm:inline-flex"
            data-testid="toolbar-lock-menu"
            aria-label="Lock options"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel>Lock</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            data-testid="lock-menu-pose"
            checked={lock.pose}
            onCheckedChange={(v) => store.getState().setLock({ pose: v })}
          >
            Pose (all figures)
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            data-testid="lock-menu-lights"
            checked={lock.lights}
            onCheckedChange={(v) => store.getState().setLock({ lights: v })}
          >
            Lights
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            data-testid="lock-menu-view"
            checked={lock.view}
            onCheckedChange={(v) => store.getState().setLock({ view: v })}
          >
            View (camera angle)
            <DropdownMenuShortcut>V</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Phones: the current tool as one button; the menu switches tools. */
function ToolMenu() {
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const current = TOOLS.find((t) => t.tool === tool) ?? TOOLS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          data-testid="toolbar-tool-menu"
          aria-label={`Tool: ${current.label}`}
          className="gap-0.5 px-1.5 text-primary sm:hidden"
        >
          {TOOLS.map(({ tool: t, Icon }) => (t === current.tool ? <Icon key={t} /> : null))}
          <ChevronDown className="size-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>Tool</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={tool}
          onValueChange={(value) => {
            const next = TOOLS.find((t) => t.tool === value);
            if (next) store.getState().setTool(next.tool);
          }}
        >
          {TOOLS.map(({ tool: t, label, Icon }) => (
            <DropdownMenuRadioItem key={t} value={t} data-testid={`toolbar-tool-menu-${t}`}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Below `md`: the actions that don't fit inline. Items hidden here are inline at that width. */
function MoreMenu() {
  const store = useEditorStore();
  const lock = useEditor((s) => s.scene.lock);
  const canRedo = useStore(store.temporal, (t) => t.futureStates.length > 0);
  const addLight = useCanAddLight();
  const s = () => store.getState();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" data-testid="toolbar-more" aria-label="More actions" className="md:hidden">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem
          data-testid="toolbar-more-redo"
          className="min-[340px]:hidden"
          disabled={!canRedo}
          onSelect={() => s().redo()}
        >
          <Redo2 />
          Redo
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="toolbar-more-add-figure" onSelect={() => s().setDialog("addFigure")}>
          <UserPlus />
          Add figure…
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="toolbar-more-add-light" disabled={!addLight.enabled} onSelect={() => s().addLight()}>
          <Lightbulb />
          {addLight.full ? `Add light (max ${MAX_LIGHTS_PER_SCENE})` : "Add light"}
        </DropdownMenuItem>
        <DropdownMenuGroup className="sm:hidden">
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Lock</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            data-testid="toolbar-more-lock-pose"
            checked={lock.pose}
            onCheckedChange={(v) => s().setLock({ pose: v })}
          >
            Pose (all figures)
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            data-testid="toolbar-more-lock-lights"
            checked={lock.lights}
            onCheckedChange={(v) => s().setLock({ lights: v })}
          >
            Lights
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            data-testid="toolbar-more-lock-view"
            checked={lock.view}
            onCheckedChange={(v) => s().setLock({ view: v })}
          >
            View (camera angle)
            <DropdownMenuShortcut>V</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="toolbar-more-export" className="sm:hidden" onSelect={() => s().setDialog("export")}>
          <Download />
          Export image…
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="toolbar-more-help" onSelect={() => s().setDialog("help")}>
          <CircleHelp />
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const STATUS_TEXT: Record<string, string> = {
  idle: "Draft",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Draft saved",
  offline: "Offline",
  error: "Not saved",
  conflict: "Conflict",
};

export type EditorPanel = "left" | "right";

export function EditorToolbar({
  onTogglePanels,
  openPanel = null,
  leading,
  trailing,
}: {
  /** Below `lg` the Scene (left) and Properties (right) panels are drawers toggled from here. */
  onTogglePanels?: (panel: EditorPanel) => void;
  /** The open drawer, if any (drives the toggles' pressed state and `aria-expanded`). */
  openPanel?: EditorPanel | null;
  /** Replaces the default title + draft status (cloud mode: workspace name, save status). */
  leading?: React.ReactNode;
  /** Extra actions before Export (cloud mode: "Save to cloud", user menu…). */
  trailing?: React.ReactNode;
}) {
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const lock = useEditor((s) => s.scene.lock);
  const persistence = useEditor((s) => s.persistence);
  const addLight = useCanAddLight();
  const past = useStore(store.temporal, (t) => t.pastStates.length);
  const future = useStore(store.temporal, (t) => t.futureStates.length);
  const s = () => store.getState();
  const lockText = lockSummary(lock);
  const divider = <Separator orientation="vertical" className="hidden h-6 sm:block" />;

  return (
    // The scroll is only a safety net for very narrow screens or unusually wide slot content.
    <header className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-card/80 px-2 backdrop-blur [scrollbar-width:none] sm:gap-2">
      <Link
        href="/"
        aria-label="Artikin home"
        className="flex shrink-0 items-center rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring max-[375px]:hidden"
      >
        <Mark className="size-7 md:hidden" />
        <Lockup className="hidden h-6 w-auto md:block" />
      </Link>
      {divider}
      {leading ?? (
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <span className="truncate text-sm text-muted-foreground">
            {persistence.mode === "guest" ? "Guest draft" : "Workspace"}
          </span>
          <span
            data-testid="save-status"
            data-status={persistence.status}
            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {STATUS_TEXT[persistence.status] ?? persistence.status}
          </span>
        </div>
      )}
      {divider}

      <div role="toolbar" aria-label="Tools" className="hidden shrink-0 items-center gap-0.5 sm:flex">
        {TOOLS.map(({ tool: t, label, key, Icon }) => (
          <IconButton
            key={t}
            label={label}
            shortcut={key}
            data-testid={`toolbar-tool-${t}`}
            aria-pressed={tool === t}
            variant={tool === t ? "secondary" : "ghost"}
            className={tool === t ? "text-primary" : ""}
            onClick={() => s().setTool(t)}
          >
            <Icon />
          </IconButton>
        ))}
      </div>
      <ToolMenu />
      {divider}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label="Undo" shortcut="Ctrl+Z" data-testid="toolbar-undo" disabled={past === 0} onClick={() => s().undo()}>
          <Undo2 />
        </IconButton>
        <IconButton
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          data-testid="toolbar-redo"
          className="max-[340px]:hidden"
          disabled={future === 0}
          onClick={() => s().redo()}
        >
          <Redo2 />
        </IconButton>
      </div>
      {divider}
      <LockControl />
      {lockText && (
        <Badge data-testid="lock-badge" variant="outline" className="hidden border-amber-400/40 text-amber-300 xl:inline-flex">
          <Lock className="size-3" />
          {lockText}
        </Badge>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {onTogglePanels && (
          <>
            <IconButton
              label="Scene panel"
              data-testid="toolbar-panel-scene"
              aria-expanded={openPanel === "left"}
              aria-controls="editor-scene-panel"
              variant={openPanel === "left" ? "secondary" : "ghost"}
              className="lg:hidden"
              onClick={() => onTogglePanels("left")}
            >
              <ListTree />
            </IconButton>
            <IconButton
              label="Properties panel"
              data-testid="toolbar-panel-properties"
              aria-expanded={openPanel === "right"}
              aria-controls="editor-properties-panel"
              variant={openPanel === "right" ? "secondary" : "ghost"}
              className="lg:hidden"
              onClick={() => onTogglePanels("right")}
            >
              <SlidersHorizontal />
            </IconButton>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          data-testid="toolbar-add-figure"
          aria-label="Add figure"
          className="hidden md:inline-flex"
          onClick={() => s().setDialog("addFigure")}
        >
          <UserPlus /> <span className="hidden xl:inline">Add figure</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="toolbar-add-light"
          aria-label="Add light"
          className="hidden md:inline-flex"
          disabled={!addLight.enabled}
          title={addLight.full ? `Up to ${MAX_LIGHTS_PER_SCENE} lights per scene` : undefined}
          onClick={() => s().addLight()}
        >
          <Lightbulb /> <span className="hidden xl:inline">Add light</span>
        </Button>
        {trailing}
        <Button
          variant="outline"
          size="sm"
          data-testid="toolbar-export"
          className="hidden sm:inline-flex"
          onClick={() => s().setDialog("export")}
        >
          <Download /> <span>Export</span>
        </Button>
        <IconButton
          label="Keyboard shortcuts"
          shortcut="?"
          data-testid="toolbar-help"
          className="hidden md:inline-flex"
          onClick={() => s().setDialog("help")}
        >
          <CircleHelp />
        </IconButton>
        <MoreMenu />
      </div>
    </header>
  );
}
