"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlatformAppPublic } from "@/lib/db/queries/platform-apps";
import { BYO_PLATFORMS, type ByoPlatform } from "@/lib/platforms/byo-keys";
import { PLATFORM_LABELS } from "@/lib/platforms/labels";
import {
  type PlatformAppState,
  removePlatformApp,
  savePlatformApp,
} from "./platform-apps-actions";

const META_LIMIT =
  "Without Meta App Review your app can post only for accounts that have a role on it.";
const LIMITS: Record<ByoPlatform, string> = {
  x: "Needs a funded X developer account (pay-per-use).",
  linkedin:
    "Personal posts work self-serve. Company pages need LinkedIn Community Management approval.",
  facebook: META_LIMIT,
  instagram: META_LIMIT,
  threads: META_LIMIT,
  tiktok:
    "Unaudited TikTok apps post only for their own test accounts, as drafts to the inbox.",
  youtube:
    "Google testing mode: up to 100 test users, private uploads, tokens expire after 7 days.",
  pinterest: "Pinterest trial access creates private pins only.",
};

const errorClass = "text-sm text-destructive";

function PlatformCard({
  platform,
  app,
  callbackBase,
  canEdit,
  isPublic,
}: {
  platform: ByoPlatform;
  app: PlatformAppPublic | undefined;
  callbackBase: string;
  canEdit: boolean;
  isPublic: boolean;
}) {
  const [saved, save] = useActionState<PlatformAppState, FormData>(
    savePlatformApp,
    { ok: false },
  );
  const [removed, remove] = useActionState<PlatformAppState, FormData>(
    removePlatformApp,
    { ok: false },
  );
  const id = `app-${platform}`;
  return (
    <section
      className="grid gap-3 rounded-lg border p-4"
      data-testid={`platform-app-${platform}`}
    >
      <h3 className="font-semibold">{PLATFORM_LABELS[platform]}</h3>
      <p className="text-sm text-muted-foreground">
        {app
          ? `Your app · client id ${app.clientId}`
          : isPublic
            ? "Using PostPipe's app"
            : "Not available until you add your own app"}
      </p>
      <form action={save} className="grid gap-3">
        <input type="hidden" name="platform" value={platform} />
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-client-id`}>Client ID</Label>
          <Input
            id={`${id}-client-id`}
            name="client_id"
            maxLength={200}
            defaultValue={app?.clientId ?? ""}
            disabled={!canEdit}
            autoComplete="off"
          />
          {saved.fields?.client_id && (
            <p role="alert" className={errorClass}>
              {saved.fields.client_id}
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-client-secret`}>Client secret</Label>
          <Input
            id={`${id}-client-secret`}
            name="client_secret"
            type="password"
            maxLength={500}
            disabled={!canEdit}
            autoComplete="off"
          />
          {saved.fields?.client_secret && (
            <p role="alert" className={errorClass}>
              {saved.fields.client_secret}
            </p>
          )}
        </div>
        {platform === "facebook" && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-extra`}>Login config ID</Label>
            <Input
              id={`${id}-extra`}
              name="extra"
              maxLength={200}
              defaultValue={app?.extra ?? ""}
              disabled={!canEdit}
              autoComplete="off"
              required
            />
            {saved.fields?.extra && (
              <p role="alert" className={errorClass}>
                {saved.fields.extra}
              </p>
            )}
          </div>
        )}
        <p className="break-all text-sm text-muted-foreground">
          Callback URL: {callbackBase}/api/oauth/{platform}/callback
        </p>
        <p className="text-sm text-muted-foreground">{LIMITS[platform]}</p>
        <div>
          <Button type="submit" disabled={!canEdit}>
            Save
          </Button>
        </div>
        {saved.error && (
          <p role="alert" className={errorClass}>
            {saved.error}
          </p>
        )}
        {saved.ok && <p role="status">Saved.</p>}
      </form>
      {app && (
        <form action={remove} className="grid gap-2">
          <input type="hidden" name="platform" value={platform} />
          <p className="text-sm text-muted-foreground">
            Removing your app breaks accounts connected through it. Reconnect
            them afterwards.
          </p>
          <div>
            <Button type="submit" variant="outline" disabled={!canEdit}>
              Remove
            </Button>
          </div>
          {removed.error && (
            <p role="alert" className={errorClass}>
              {removed.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export function PlatformAppsForm({
  apps,
  callbackBase,
  canEdit,
  publicPlatforms,
}: {
  apps: PlatformAppPublic[];
  callbackBase: string;
  canEdit: boolean;
  publicPlatforms: string[];
}) {
  return (
    <div className="grid gap-3">
      {!canEdit && (
        <p className="text-muted-foreground">
          Only the owner can change platform apps.
        </p>
      )}
      {BYO_PLATFORMS.map((p) => (
        <PlatformCard
          key={p}
          platform={p}
          app={apps.find((a) => a.platform === p)}
          callbackBase={callbackBase}
          canEdit={canEdit}
          isPublic={publicPlatforms.includes(p)}
        />
      ))}
    </div>
  );
}
