export type Mode = "live" | "test";

/** The `?mode=` search param; anything but "test" is live. */
export const parseMode = (v: string | string[] | undefined): Mode =>
  v === "test" ? "test" : "live";

export type ModeProps = { searchParams: Promise<{ mode?: string }> };
