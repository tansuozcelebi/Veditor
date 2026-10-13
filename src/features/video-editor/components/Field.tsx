import { useState, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground border-b text-[11px] font-semibold tracking-wide uppercase pb-1 mt-2">{children}</div>;
}

/** Slider with a live value read-out. `unit` '%' multiplies by 100, 'pct' shows the raw value as a percentage. */
export function RangeField({ label, value, min, max, step, unit, onChange, onCommit, testId }: {
  label: string; value: number; min: number; max: number; step: number; unit?: '%' | 'pct' | '×' | 's' | '';
  onChange: (v: number) => void; onCommit?: (v: number) => void; testId?: string;
}) {
  // live edits often skip the store's change event (to keep undo history clean), so the slider keeps
  // its own value while it is being dragged instead of waiting for a re-render that never comes
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;
  const text = unit === '%' ? Math.round(shown * 100) + '%' : unit === 'pct' ? shown.toFixed(1) + '%' : shown.toFixed(2) + (unit || '');
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <Slider data-testid={testId} className="flex-1" min={min} max={max} step={step} value={[shown]} onValueChange={(v) => { setDragging(v[0]); onChange(v[0]); }} onValueCommit={(v) => { setDragging(null); onCommit?.(v[0]); }} />
        <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{text}</span>
      </div>
    </Field>
  );
}
