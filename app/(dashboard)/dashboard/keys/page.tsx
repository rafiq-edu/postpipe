import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listApiKeys } from "@/lib/db/queries/api-keys";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { type ModeProps, parseMode } from "../mode";
import { revokeKey } from "./actions";
import { CreateKeyForm } from "./create-key-form";

export default async function KeysPage({ searchParams }: ModeProps) {
  const mode = parseMode((await searchParams).mode);
  const { orgId } = await getCurrentOrg();
  const keys = (await listApiKeys(orgId)).filter((k) => k.mode === mode);
  return (
    <>
      <PageHeader
        title="API keys"
        summary={`Keys for the ${mode} API. A key is shown once, when you create it.`}
      />
      <CreateKeyForm mode={mode} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((k) => (
            <TableRow key={k.id}>
              <TableCell
                label="Name"
                title={k.name ?? undefined}
                className="max-w-56 truncate max-md:max-w-none"
              >
                {k.name}
              </TableCell>
              <TableCell label="Key" className="font-mono">
                {k.key_prefix}…{k.last4}
              </TableCell>
              <TableCell label="Mode" className="capitalize">
                {k.mode}
              </TableCell>
              <TableCell label="Created" className="tabular-nums">
                {k.created_at && <LocalTime iso={k.created_at} short />}
              </TableCell>
              <TableCell className="text-right">
                {k.revoked_at ? (
                  <StatusChip tone="off" label="Revoked" />
                ) : (
                  <form action={revokeKey}>
                    <input type="hidden" name="id" value={k.id ?? ""} />
                    <Button type="submit" variant="outline" size="sm">
                      Revoke
                    </Button>
                  </form>
                )}
              </TableCell>
            </TableRow>
          ))}
          {keys.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                No {mode} keys.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
