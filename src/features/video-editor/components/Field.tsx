import type { ReactNode } from 'react';
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
  const text = unit === '%' ? Math.round(value * 100) + '%' : unit === 'pct' ? value.toFixed(1) + '%' : value.toFixed(2) + (unit || '');
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <Slider data-testid={testId} className="flex-1" min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0])} onValueCommit={(v) => onCommit?.(v[0])} />
        <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{text}</span>
      </div>
    </Field>
  );
}
