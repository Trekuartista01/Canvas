import { trpc } from "@/lib/trpc";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

const ACTION_LABELS: Record<string, string> = {
  "payroll.list_viewed": "opened the payroll table",
  "payroll.viewed": "viewed the record of",
  "payroll.updated": "changed the record of",
  "payroll.exported": "exported payroll",
  "payroll.self_viewed": "viewed their own pay details",
  "contract.list_viewed": "opened the contracts list",
  "contract.viewed": "viewed the contracts of",
  "contract.created": "added a contract for",
  "contract.updated": "changed a contract of",
  "contract.deleted": "deleted a contract of",
  "contract.files_added": "added pages to a contract of",
  "contract.file_replaced": "replaced a contract file of",
  "contract.file_deleted": "deleted a contract file of",
  "contract.file_viewed": "viewed a contract file of",
  "contract.downloaded": "downloaded a contract file of",
  "leave.vendim_downloaded": "downloaded a Vendim of",
  "person.confidential_viewed": "viewed the confidential details of",
  "person.confidential_updated": "changed the confidential details of",
  "person.profile_viewed": "viewed the profile of",
  "person.profile_updated": "changed the profile of",
  "person.created": "added",
  "person.role_changed": "changed the role of",
};

/** "leave.self_approved" → "leave self approved", for anything not listed above. */
function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

// Spec §1: who did what to HR data, when, and from which IP. HR only
// (audit.list checks hr:audit). Payloads hold field names, never values.
export function HrAccessLog({ workspaceId }: { workspaceId: string }) {
  const log = trpc.audit.list.useQuery({ workspaceId });
  const rows = log.data ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 15,
  });

  if (log.isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (log.error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {log.error.message}
      </p>
    );
  }
  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="hr-access-log">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const r = rows[item.index]!;
          return (
            <div
              key={r.id}
              className="border-border absolute right-0 left-0 flex gap-3 border-b px-2 py-1.5 text-sm"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <span className="text-muted-foreground w-36 shrink-0 text-xs tabular-nums">
                {new Date(r.createdAt).toLocaleString()}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.actorName ?? "Someone"}</span>{" "}
                {actionLabel(r.action)}
                {r.subjectName && r.action !== "payroll.self_viewed" && (
                  <span className="font-medium"> {r.subjectName}</span>
                )}
                {r.fields && (
                  <span className="text-muted-foreground"> ({r.fields.join(", ")})</span>
                )}
                {r.format && (
                  <span className="text-muted-foreground"> as {r.format.toUpperCase()}</span>
                )}
              </span>
              <span className="text-muted-foreground hidden shrink-0 font-mono text-xs sm:inline">
                {r.ip ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
