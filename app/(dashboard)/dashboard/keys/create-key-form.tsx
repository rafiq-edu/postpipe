"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type CreateKeyState, createKey } from "./actions";

export const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function CreateKeyForm({ mode }: { mode: "live" | "test" }) {
  const [state, action] = useActionState<CreateKeyState, FormData>(
    createKey,
    {},
  );
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="key-name">Name</Label>
        <Input id="key-name" name="name" required maxLength={60} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="key-mode">Mode</Label>
        <select
          id="key-mode"
          name="mode"
          defaultValue={mode}
          className={selectClass}
        >
          <option value="test">test</option>
          <option value="live">live</option>
        </select>
      </div>
      <Button type="submit">Create key</Button>
      {state.error && (
        <p
          role="alert"
          className="w-full rounded-md bg-danger-soft p-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      {state.plaintext && (
        <p className="w-full text-sm break-all">
          <code
            data-testid="new-key"
            className="rounded-md bg-muted px-1.5 py-0.5 font-mono"
          >
            {state.plaintext}
          </code>{" "}
          Copy it now. It is shown once.
        </p>
      )}
    </form>
  );
}
