import {
  type DisplayStatus,
  StatusLabel,
} from "@/app/(dashboard)/dashboard/posts/status";
import { StatusChip } from "@/components/status-chip";

// Static sample test data. No database, no server-only code.
const ROWS: {
  title: string;
  id: string;
  status: DisplayStatus;
  at: string;
}[] = [
  {
    title: "October launch",
    id: "pst_4f2a",
    status: "error",
    at: "10:42",
  },
  {
    title: "Release notes",
    id: "pst_9c1d",
    status: "success",
    at: "10:36",
  },
  {
    title: "Product preview",
    id: "pst_3d9f",
    status: "running",
    at: "10:21",
  },
  {
    title: "Friday roundup",
    id: "pst_6a2c",
    status: "pending",
    at: "10:15",
  },
];

const TRAIL = [
  { step: "Received", at: "10:42:01", ok: true },
  { step: "Queued", at: "10:42:02", ok: true },
  { step: "Mock delivery failed", at: "10:42:04", ok: false },
];

/** Hero fragment of the Posts screen, built from the app's own pieces. */
export function PostsPreview() {
  return (
    <figure className="overflow-hidden rounded-lg border bg-panel">
      <figcaption className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">Posts</span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          Test
        </span>
      </figcaption>
      <div className="grid md:grid-cols-[1.5fr_1fr]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-normal">Post</th>
              <th className="hidden px-2 py-2 font-normal sm:table-cell">
                Platform
              </th>
              <th className="px-2 py-2 font-normal">Status</th>
              <th className="hidden px-4 py-2 font-normal sm:table-cell">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr
                key={r.id}
                className={
                  i === 0 ? "border-b bg-muted" : "border-b last:border-0"
                }
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{r.title}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {r.id}
                  </div>
                </td>
                <td className="hidden px-2 py-3 sm:table-cell">Mock</td>
                <td className="px-2 py-3">
                  <StatusLabel status={r.status} />
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {r.at}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hidden border-l p-4 md:block">
          <p className="font-semibold">October launch</p>
          <p className="font-mono text-xs text-muted-foreground">pst_4f2a</p>
          <p className="mt-3 text-xs font-medium">Delivery trail</p>
          <ol className="mt-2 space-y-2">
            {TRAIL.map((t) => (
              <li
                key={t.step}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <StatusChip tone={t.ok ? "ok" : "error"} label={t.step} />
                <span className="font-mono text-xs text-muted-foreground">
                  {t.at}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        Sample test data. Test posts do not publish.
      </p>
    </figure>
  );
}
