import Link from "next/link";
import { SyncPanel } from "@/components/SyncPanel";
import { formatDate } from "@/lib/fulfill";
import { requireSession, staffFetch } from "@/lib/session-server";
import type { AuditEntry } from "@/lib/types";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await requireSession("admin");
  const { before } = await searchParams;
  const q = new URLSearchParams({ limit: "50" });
  if (before && /^\d{1,20}$/.test(before)) q.set("before", before);
  const { entries, nextBefore } = await staffFetch<{ entries: AuditEntry[]; nextBefore: number | null }>(`/admin/audit?${q}`);

  return (
    <>
      <h1>Audit log</h1>
      <SyncPanel />
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Result</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.at)}</td>
              <td>
                {e.staffEmail ?? <span className="muted">—</span>} {e.role ? <span className="muted">({e.role})</span> : null}
              </td>
              <td>{e.action}</td>
              <td>
                <code>{e.resourceId ?? "—"}</code>
              </td>
              <td className={e.result === "denied" || e.result === "error" || e.result === "rejected" ? "error" : undefined}>
                {e.result}
                {e.statusCode ? ` (${e.statusCode})` : ""}
              </td>
              <td>
                <code>{e.detail ? JSON.stringify(e.detail) : ""}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {nextBefore ? (
        <p>
          <Link href={`/audit?before=${nextBefore}`}>Older →</Link>
        </p>
      ) : null}
    </>
  );
}
