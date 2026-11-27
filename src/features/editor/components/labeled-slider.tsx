"use client";

import { cn } from "cn";
import { Slider as SliderPrimitive } from "radix-ui";
import { type KeyboardEvent, useEffect, useId, useState } from "react";

import { Input } from "@/components/ui/input";

export interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Formats the value for screen readers / read-only display (default: rounded number + unit). */
  format?: (value: number) => string;
  unit?: string;
  /** Text under the slider ends, e.g. ["Extension", "Flexion"]. */
  ends?: [left: string, right: string];
  disabled?: boolean;
  /** Called continuously while dragging / on every key step. */
  onChange: (value: number) => void;
  /** Gesture boundaries (one drag = one undo step). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  sliderTestId?: string;
  inputTestId?: string;
  /** Show a numeric input next to the slider. */
  withInput?: boolean;
  /** Small color dot before the label (matches the gizmo ring color). */
  accent?: string;
}

/**
 * Accessible slider + optional numeric input (PROJECT §13, A11Y): the thumb (`role="slider"`) has an
 * accessible name and min/max; the numeric input applies on Enter or blur and always shows the
 * stored value (clamped by the store).
 */
export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  unit = "",
  ends,
  disabled,
  onChange,
  onGestureStart,
  onGestureEnd,
  sliderTestId,
  inputTestId,
  withInput = true,
  accent,
}: LabeledSliderProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = format ? format(value) : `${Math.round(value * 10) / 10}${unit}`;

  useEffect(() => {
    if (!onGestureEnd) return;
    // Pointer drags can end anywhere on the page.
    const end = () => onGestureEnd();
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [onGestureEnd]);

  const commitDraft = () => {
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(n)) onChange(n);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Escape") {
      setDraft(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          id={`${id}-label`}
          htmlFor={withInput ? `${id}-input` : undefined}
          className="text-xs font-medium text-foreground/90"
        >
          {accent && (
            <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: accent }} />
          )}
          {label}
        </label>
        {withInput ? (
          <Input
            id={`${id}-input`}
            data-testid={inputTestId}
            inputMode="decimal"
            className="h-6 w-20 px-1.5 text-right font-mono text-xs tabular-nums"
            value={draft ?? String(Math.round(value * 100) / 100)}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={onKeyDown}
          />
        ) : (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{shown}</span>
        )}
      </div>
      <SliderPrimitive.Root
        className={cn("relative flex h-4 w-full touch-none items-center select-none data-disabled:opacity-50")}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onPointerDownCapture={() => {
          if (!disabled) onGestureStart?.();
        }}
        onValueChange={(v) => {
          if (typeof v[0] === "number") onChange(v[0]);
        }}
      >
        <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full bg-primary/80" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-testid={sliderTestId}
          aria-labelledby={`${id}-label`}
          aria-valuetext={shown}
          className="block size-3.5 rounded-full border border-ring bg-white shadow ring-ring/50 transition-[box-shadow] hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
        />
      </SliderPrimitive.Root>
      {ends && (
        <div className="flex justify-between text-[10px] leading-none text-muted-foreground">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}
