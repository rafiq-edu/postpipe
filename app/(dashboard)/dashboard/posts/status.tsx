import { CircleAlert, CircleCheck, Clock, Ellipsis, X } from "lucide-react";

export type DisplayStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "cancelled";

// Post DB status -> status shown in the UI. "partial" counts as error.
export const DB_TO_DISPLAY: Record<string, DisplayStatus> = {
  draft: "pending",
  scheduled: "pending",
  processing: "running",
  completed: "success",
  partial: "error",
  failed: "error",
  cancelled: "cancelled",
};

export type PostStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export const DISPLAY_TO_DB: Record<DisplayStatus, PostStatus[]> = {
  pending: ["draft", "scheduled"],
  running: ["processing"],
  success: ["completed"],
  error: ["failed", "partial"],
  cancelled: ["cancelled"],
};

const LOOK = {
  pending: { Icon: Clock, cls: "text-muted-foreground" },
  running: { Icon: Ellipsis, cls: "text-muted-foreground" },
  success: { Icon: CircleCheck, cls: "text-ok" },
  error: { Icon: CircleAlert, cls: "text-destructive" },
  cancelled: { Icon: X, cls: "text-muted-foreground" },
} as const;

export function StatusLabel({ status }: { status: DisplayStatus }) {
  const { Icon, cls } = LOOK[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${cls}`}>
      <Icon className="size-4.5" aria-hidden />
      <span className={status === "error" ? "font-medium" : "text-foreground"}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    </span>
  );
}
