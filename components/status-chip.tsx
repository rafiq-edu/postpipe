import {
  CircleAlert,
  CircleCheck,
  Clock,
  type LucideIcon,
  TriangleAlert,
  X,
} from "lucide-react";

const TONES: Record<string, { Icon: LucideIcon; cls: string }> = {
  ok: { Icon: CircleCheck, cls: "text-ok" },
  warn: { Icon: TriangleAlert, cls: "text-warn" },
  error: { Icon: CircleAlert, cls: "text-destructive" },
  pending: { Icon: Clock, cls: "text-muted-foreground" },
  off: { Icon: X, cls: "text-muted-foreground" },
};

export type Tone = keyof typeof TONES;

/** Status as icon plus word. */
export function StatusChip({ tone, label }: { tone: Tone; label: string }) {
  const { Icon, cls } = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${cls}`}>
      <Icon className="size-4.5 shrink-0" aria-hidden />
      <span className={tone === "error" ? "font-medium" : "text-foreground"}>
        {label}
      </span>
    </span>
  );
}
