import { LocalTime } from "@/components/local-time";
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
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { createServerSupabase } from "@/lib/db/server";
import { type ModeProps, parseMode } from "../mode";
import { deleteEndpointAction, replayDeliveryAction } from "./actions";
import { CreateEndpointForm } from "./create-endpoint-form";

const DELIVERY: Record<string, [Tone, string]> = {
  pending: ["pending", "Pending"],
  delivered: ["ok", "Delivered"],
  dead: ["error", "Failed"],
};

export default async function WebhooksPage({ searchParams }: ModeProps) {
  const mode = parseMode((await searchParams).mode);
  const { orgId } = await getCurrentOrg();
  const supabase = await createServerSupabase();
  const [{ data: endpoints }, { data: deliveries }] = await Promise.all([
    supabase
      .from("webhook_endpoints")
      .select("id, mode, url, events, enabled, created_at")
      .eq("org_id", orgId)
      .eq("mode", mode)
      .order("created_at", { ascending: false }),
    supabase
      .from("webhook_deliveries")
      .select("id, event, status, attempt, response_code, created_at")
      .eq("org_id", orgId)
      .eq("mode", mode)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  return (
    <>
      <PageHeader
        title="Webhooks"
        summary={`Endpoints and recent deliveries for ${mode} mode.`}
      />
      <CreateEndpointForm mode={mode} />
      <Table aria-label="Endpoints">
        <TableHeader>
          <TableRow>
            <TableHead>URL</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(endpoints ?? []).map((e) => (
            <TableRow key={e.id}>
              <TableCell
                label="URL"
                title={e.url}
                className="min-w-56 break-all whitespace-normal"
              >
                {e.url}
              </TableCell>
              <TableCell label="Mode" className="capitalize">
                {e.mode}
              </TableCell>
              <TableCell label="Events" className="whitespace-normal">
                {e.events.join(", ")}
              </TableCell>
              <TableCell label="Created" className="tabular-nums">
                <LocalTime iso={e.created_at} short />
              </TableCell>
              <TableCell className="text-right">
                <form action={deleteEndpointAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="mode" value={e.mode} />
                  <Button type="submit" variant="outline" size="sm">
                    Delete
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          ))}
          {(endpoints ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                No {mode} endpoints.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <h2 className="text-lg font-semibold">Deliveries</h2>
      <Table aria-label="Deliveries">
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Attempt</TableHead>
            <TableHead className="text-right">Response</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(deliveries ?? []).map((d) => (
            <TableRow key={d.id} data-testid="delivery-row">
              <TableCell label="Event" className="break-all">
                {d.event}
              </TableCell>
              <TableCell label="Status">
                <StatusChip
                  tone={DELIVERY[d.status]?.[0] ?? "off"}
                  label={DELIVERY[d.status]?.[1] ?? d.status}
                />
              </TableCell>
              <TableCell label="Attempt" className="text-right tabular-nums">
                {d.attempt}
              </TableCell>
              <TableCell label="Response" className="text-right tabular-nums">
                {d.response_code ?? "-"}
              </TableCell>
              <TableCell label="Created" className="tabular-nums">
                <LocalTime iso={d.created_at} />
              </TableCell>
              <TableCell className="text-right">
                {d.status !== "pending" && (
                  <form action={replayDeliveryAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Replay
                    </Button>
                  </form>
                )}
              </TableCell>
            </TableRow>
          ))}
          {(deliveries ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No deliveries.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
