"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy post ID"
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {done ? (
        <>
          <Check className="size-4" aria-hidden />
          <span className="text-xs">Copied</span>
        </>
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
    </button>
  );
}
