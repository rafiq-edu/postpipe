"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type BrandingState, saveBrandingAction } from "./branding-actions";

export function BrandingForm({
  name,
  logoUrl,
  canEdit,
}: {
  name: string;
  logoUrl: string | null;
  canEdit: boolean;
}) {
  const [state, action] = useActionState<BrandingState, FormData>(
    saveBrandingAction,
    {},
  );
  return (
    <form action={action} className="grid max-w-md gap-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Connect page branding</h2>
      {!canEdit && (
        <p className="text-muted-foreground">
          Only the owner can change branding.
        </p>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="brand-name">Display name</Label>
        <Input
          id="brand-name"
          name="name"
          maxLength={60}
          defaultValue={name}
          disabled={!canEdit}
        />
      </div>
      {logoUrl && (
        // biome-ignore lint/performance/noImgElement: presigned S3 URL, next/image not configured for it
        <img
          src={logoUrl}
          alt="Current logo"
          data-testid="logo-preview"
          className="max-h-10 w-auto self-start"
        />
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="brand-logo">Logo (PNG, JPEG or WebP, 512 KB max)</Label>
        <Input
          id="brand-logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={!canEdit}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canEdit}>
          Save branding
        </Button>
        {logoUrl && (
          <Button
            type="submit"
            name="remove_logo"
            value="1"
            variant="outline"
            disabled={!canEdit}
          >
            Remove logo
          </Button>
        )}
      </div>
      {state.error && (
        <p
          role="alert"
          className="rounded-md bg-danger-soft p-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      {state.ok && <p role="status">Saved.</p>}
    </form>
  );
}
