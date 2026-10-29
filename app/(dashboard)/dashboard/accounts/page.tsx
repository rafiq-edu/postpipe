import { PageHeader } from "@/components/page-header";
import { StatusChip, type Tone } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PICKED_OR } from "@/lib/connect/unpicked";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { createServerSupabase } from "@/lib/db/server";
import { platformLabel } from "@/lib/posts/view";
import { type ModeProps, parseMode } from "../mode";
import { disconnectAccountAction } from "./actions";
import { tokenHealth } from "./token-health";

const HEALTH: Record<string, [Tone, string]> = {
  ok: ["ok", "Healthy"],
  expiring: ["warn", "Expiring"],
  expired: ["error", "Expired"],
};
const STATUS: Record<string, [Tone, string]> = {
  connected: ["ok", "Connected"],
  expired: ["error", "Expired"],
  revoked: ["error", "Revoked"],
  disconnected: ["off", "Disconnected"],
};

export default async function AccountsPage({ searchParams }: ModeProps) {
  const mode = parseMode((await searchParams).mode);
  const { orgId } = await getCurrentOrg();
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("social_accounts_public")
    .select(
      "id, platform, display_name, username, status, token_expires_at, refresh_expires_at",
    )
    .eq("org_id", orgId)
    .eq("mode", mode)
    .is("deleted_at", null)
    .or(PICKED_OR)
    .order("created_at", { ascending: false });
  const accounts = data ?? [];
  return (
    <>
      <PageHeader
        title="Accounts"
        summary={`Connected ${mode} accounts: ${accounts.length}.`}
      />
      {accounts.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No connected accounts.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Platform</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Token</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const health = tokenHealth({
                status: a.status ?? "",
                token_expires_at: a.token_expires_at,
                refresh_expires_at: a.refresh_expires_at,
              });
              return (
                <TableRow key={a.id}>
                  <TableCell label="Platform">
                    {platformLabel(a.platform ?? "")}
                  </TableCell>
                  <TableCell
                    label="Name"
                    title={a.display_name ?? a.username ?? undefined}
                    className="max-w-56 truncate max-md:max-w-none"
                  >
                    {a.display_name ?? a.username ?? "-"}
                  </TableCell>
                  <TableCell label="Status">
                    <StatusChip
                      tone={STATUS[a.status ?? ""]?.[0] ?? "off"}
                      label={STATUS[a.status ?? ""]?.[1] ?? a.status ?? "-"}
                    />
                  </TableCell>
                  <TableCell label="Token">
                    <StatusChip
                      tone={HEALTH[health][0]}
                      label={HEALTH[health][1]}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {a.status !== "disconnected" && (
                      <form action={disconnectAccountAction}>
                        <input type="hidden" name="id" value={a.id ?? ""} />
                        <input type="hidden" name="mode" value={mode} />
                        <Button type="submit" variant="outline" size="sm">
                          Disconnect
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
