"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WEBHOOK_EVENTS } from "@/lib/api/schemas/webhooks";
import { selectClass } from "../keys/create-key-form";
import { type CreateEndpointState, createEndpointAction } from "./actions";

export function CreateEndpointForm({ mode }: { mode: "live" | "test" }) {
  const [state, action] = useActionState<CreateEndpointState, FormData>(
    createEndpointAction,
    {},
  );
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
    >
      <div className="grid min-w-0 flex-1 basis-full gap-1.5 sm:basis-64">
        <Label htmlFor="ep-url">URL</Label>
        <Input id="ep-url" name="url" type="url" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ep-mode">Mode</Label>
        <select
          id="ep-mode"
          name="mode"
          defaultValue={mode}
          className={selectClass}
        >
          <option value="test">test</option>
          <option value="live">live</option>
        </select>
      </div>
      <fieldset className="flex w-full flex-wrap gap-x-4 gap-y-1">
        <legend className="sr-only">Events</legend>
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="events" value={e} /> {e}
          </label>
        ))}
      </fieldset>
      <Button type="submit">Create endpoint</Button>
      {state.error && (
        <p
          role="alert"
          className="w-full rounded-md bg-danger-soft p-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      {state.secret && (
        <p className="w-full text-sm break-all">
          <code
            data-testid="new-secret"
            className="rounded-md bg-muted px-1.5 py-0.5 font-mono"
          >
            {state.secret}
          </code>{" "}
          Copy it now. It is shown once.
        </p>
      )}
    </form>
  );
}
