import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  CONTRACT_KIND_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  formatDmy,
} from "@canvas/shared";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

function Group({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId}>
      <h3 className="text-muted-foreground mb-1 text-xs font-medium">{title}</h3>
      <ul className="divide-border divide-y rounded-md border">{children}</ul>
    </section>
  );
}

const ROW = "hover:bg-muted flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm";
const HINT = "text-muted-foreground text-xs";

// P8.8 (spec §9): people and work in one box. The server decides what this
// person may find, so the HR groups only exist in HR's response. A search can
// write an access-log row, so it isn't repeated on window focus.
export function GlobalSearch({ workspaceId }: { workspaceId: string }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const results = trpc.search.global.useQuery(
    { workspaceId, query },
    { enabled: query.length > 0, refetchOnWindowFocus: false },
  );
  const data = results.data;
  const hr = data && "hr" in data ? data.hr : null;
  const clients = data && "clients" in data ? data.clients : [];
  const nothing =
    data &&
    data.people.length === 0 &&
    data.tasks.length === 0 &&
    clients.length === 0 &&
    (!hr ||
      (hr.contracts.length === 0 &&
        hr.payroll.length === 0 &&
        hr.leave.length === 0 &&
        hr.vendims.length === 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search people and work</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input.trim());
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="A name, a task…"
            aria-label="Search people and work"
            maxLength={200}
            className="h-8 text-sm"
            data-testid="global-search-input"
          />
          <Button type="submit" size="sm" disabled={!input.trim()}>
            Find
          </Button>
        </form>

        {query.length > 0 && (
          <div className="space-y-3" data-testid="global-search-results">
            {results.isLoading && <p className={HINT}>Searching…</p>}
            {results.error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {results.error.message}
              </p>
            )}
            {nothing && <p className={HINT}>Nothing found.</p>}

            {data && data.people.length > 0 && (
              <Group title="People" testId="global-search-people">
                {data.people.map((p) => (
                  <li key={p.userId}>
                    <Link
                      to="/w/$workspaceId/people/$userId"
                      params={{ workspaceId, userId: p.userId }}
                      className={ROW}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className={HINT}>
                        {[p.jobTitle, p.department, p.email].filter(Boolean).join(" · ")}
                        {p.archived ? " · Archived" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </Group>
            )}

            {data && data.tasks.length > 0 && (
              <Group title="Tasks" testId="global-search-tasks">
                {data.tasks.map((t) => (
                  <li key={t.id}>
                    <Link
                      to="/w/$workspaceId/l/$listId"
                      params={{ workspaceId, listId: t.listId }}
                      search={{ openTask: t.id }}
                      className={ROW}
                    >
                      <span className="font-medium">{t.title}</span>
                      <span className={HINT}>
                        {t.spaceName} / {t.listName}
                      </span>
                    </Link>
                  </li>
                ))}
              </Group>
            )}

            {clients.length > 0 && (
              <Group title="Clients" testId="global-search-clients">
                {clients.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/w/$workspaceId/clients/$clientId"
                      params={{ workspaceId, clientId: c.id }}
                      className={ROW}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className={HINT}>Client folder</span>
                    </Link>
                  </li>
                ))}
              </Group>
            )}

            {hr && hr.contracts.length > 0 && (
              <Group title="Contracts" testId="global-search-contracts">
                {hr.contracts.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/w/$workspaceId/contracts"
                      params={{ workspaceId }}
                      search={{ person: c.userId }}
                      className={ROW}
                    >
                      <span className="font-medium">{c.title}</span>
                      <span className={HINT}>
                        {c.userName} · {CONTRACT_KIND_LABELS[c.kind]} · {c.files}{" "}
                        {c.files === 1 ? "file" : "files"}
                        {c.endDate ? ` · ends ${formatDmy(c.endDate)}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </Group>
            )}

            {hr && hr.payroll.length > 0 && (
              <Group title="Payroll" testId="global-search-payroll">
                {hr.payroll.map((p) => (
                  <li key={p.userId}>
                    <Link
                      to="/w/$workspaceId/payroll"
                      params={{ workspaceId }}
                      search={{ person: p.userId }}
                      className={ROW}
                    >
                      <span className="font-medium">{p.userName}</span>
                      <span className={HINT}>Payroll record</span>
                    </Link>
                  </li>
                ))}
              </Group>
            )}

            {hr && hr.leave.length > 0 && (
              <Group title="Leave requests" testId="global-search-leave">
                {hr.leave.map((l) => (
                  <li key={l.id}>
                    <Link
                      to="/w/$workspaceId/leave-approvals"
                      params={{ workspaceId }}
                      search={{ request: l.id }}
                      className={ROW}
                    >
                      <span className="font-medium">{l.userName}</span>
                      <span className={HINT}>
                        {LEAVE_TYPE_LABELS[l.type]} · {formatDmy(l.startDate)} –{" "}
                        {formatDmy(l.endDate)} · {LEAVE_STATUS_LABELS[l.status]}
                      </span>
                    </Link>
                  </li>
                ))}
              </Group>
            )}

            {hr && hr.vendims.length > 0 && (
              <Group title="Vendims" testId="global-search-vendims">
                {hr.vendims.map((l) => (
                  <li key={l.id}>
                    <Link
                      to="/w/$workspaceId/leave-approvals"
                      params={{ workspaceId }}
                      search={{ request: l.id }}
                      className={ROW}
                    >
                      <span className="font-medium">{l.userName}</span>
                      <span className={HINT}>
                        Vendim · {formatDmy(l.startDate)} – {formatDmy(l.endDate)}
                      </span>
                    </Link>
                  </li>
                ))}
              </Group>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
