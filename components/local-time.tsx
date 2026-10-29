"use client";

import { useEffect, useState } from "react";

const twoBase = { hour: "2-digit", minute: "2-digit" } as const;

// Server renders UTC; the browser swaps in local time after mount.
function format(iso: string, short: boolean, timeZone?: string) {
  const d = new Date(iso);
  const two = { ...twoBase, timeZone } as const;
  if (short) {
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString("en-GB", two)
      : d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone,
        });
  }
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  return `${date} at ${d.toLocaleTimeString("en-GB", { ...two, second: "2-digit" })}`;
}

export function LocalTime({
  iso,
  short = false,
  className,
}: {
  iso: string;
  short?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() => format(iso, short, "UTC"));
  useEffect(() => setText(format(iso, short)), [iso, short]);
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
