import { cn } from "@/lib/utils";

/** Orange P mark (thick rounded stroke with a pipe stem) plus the wordmark. */
export function Logo({
  markOnly,
  className,
}: {
  markOnly?: boolean;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="PostPipe"
      className={cn("inline-flex items-center gap-2", className)}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        className="size-[1.4em] shrink-0 text-brand"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 29V6h11a7 7 0 0 1 0 14H11" />
        <path d="M11 29v-4a5 5 0 0 1 5-5h1" />
      </svg>
      {markOnly ? null : (
        <span aria-hidden="true" className="font-bold tracking-tight">
          PostPipe
        </span>
      )}
    </span>
  );
}
