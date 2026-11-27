"use client";

import { type KeyboardEvent, useId, useState } from "react";

import { Input } from "@/components/ui/input";

/** Numeric field that applies on Enter / blur and always shows the stored value. */
export function NumberField({
  label,
  value,
  onCommit,
  testId,
  disabled,
  step = 0.01,
  suffix,
  digits = 2,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  testId?: string;
  disabled?: boolean;
  step?: number;
  suffix?: string;
  digits?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(n)) onCommit(n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") setDraft(null);
  };
  const f = 10 ** digits;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
        {suffix ? ` (${suffix})` : ""}
      </label>
      <Input
        id={id}
        data-testid={testId}
        inputMode="decimal"
        step={step}
        className="h-7 px-1.5 font-mono text-xs tabular-nums"
        value={draft ?? String(Math.round(value * f) / f)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

/** Text field committing on Enter / blur (names). */
export function TextField({
  label,
  value,
  onCommit,
  testId,
  maxLength = 40,
  disabled,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  testId?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = draft.trim();
    setDraft(null);
    if (v && v !== value) onCommit(v);
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        data-testid={testId}
        maxLength={maxLength}
        className="h-7 text-sm"
        value={draft ?? value}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") setDraft(null);
        }}
      />
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>;
}
