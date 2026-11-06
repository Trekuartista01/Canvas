import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { createRoute, Link } from "@tanstack/react-router";
import { Check, ChevronLeft, Clock, Copy, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const copywriterHistoryRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/copywriter/history",
  component: CopywriterHistoryPage,
});

type Variant = { label: string; text?: string; design_copy?: string; caption?: string };

function timeAgo(dateStr: string | Date): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function CopywriterHistoryPage() {
  const { workspaceId } = copywriterHistoryRoute.useParams();
  const utils = trpc.useUtils();
  const generations = trpc.copywriter.listMine.useQuery({ workspaceId });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const invalidate = () => utils.copywriter.listMine.invalidate({ workspaceId });
  const remove = trpc.copywriter.delete.useMutation({ onSuccess: invalidate });
  const approve = trpc.copywriter.approve.useMutation({ onSuccess: invalidate });

  function copyText(text: string, key: string) {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  function isApproved(approved: Variant[], v: Variant) {
    return approved.some((a) => a.text === v.text);
  }

  function toggleApprove(generationId: string, approved: Variant[], v: Variant) {
    const next = isApproved(approved, v)
      ? approved.filter((a) => a.text !== v.text)
      : [...approved, v];
    approve.mutate({ generationId, approved: next });
  }

  return (
    <div className="space-y-6 p-6" data-testid="copywriter-history-page">
      <Link
        to="/w/$workspaceId/copywriter"
        params={{ workspaceId }}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        Back
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Generated copy</h1>
        <p className="text-muted-foreground text-xs">
          Everything you've generated, most recent first.
        </p>
      </div>

      {generations.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (generations.data?.length ?? 0) === 0 ? (
        <Card className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
          <Clock className="h-6 w-6 opacity-40" aria-hidden />
          No generations yet — go generate some copy.
        </Card>
      ) : (
        <div className="space-y-2">
          {generations.data?.map((g) => {
            const isOpen = expanded === g.id;
            const variants = (g.variantsJson ?? []) as Variant[];
            const approved = (g.approvedJson ?? []) as Variant[];
            return (
              <Card
                key={g.id}
                className="overflow-hidden p-0"
                data-testid={`copywriter-generation-${g.id}`}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : g.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{g.copyType}</p>
                    <p className="text-muted-foreground text-xs">
                      {g.length} ·{" "}
                      {g.language === "sq" ? "Shqip" : g.language === "en" ? "English" : "Both"} ·{" "}
                      {g.status === "pending"
                        ? "Generating…"
                        : g.status === "failed"
                          ? "Failed"
                          : timeAgo(g.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Delete generation"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove.mutate({ generationId: g.id });
                      }}
                      className="text-muted-foreground hover:text-foreground p-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="text-muted-foreground text-xs">{isOpen ? "▲" : "▼"}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-border space-y-3 border-t px-4 pb-4">
                    {g.designRead && (
                      <p className="pt-3 text-sm italic opacity-70">"{g.designRead}"</p>
                    )}
                    {variants.map((v, idx) => (
                      <div key={idx} className="bg-muted rounded-md p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="bg-background text-accent rounded-full px-2 py-0.5 text-xs uppercase">
                            {v.label}
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              title="Approve — teaches the tool this brand's real voice"
                              onClick={() => toggleApprove(g.id, approved, v)}
                              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                                isApproved(approved, v)
                                  ? "bg-accent text-accent-foreground border-accent"
                                  : "border-border opacity-60"
                              }`}
                            >
                              <ThumbsUp className="h-2.5 w-2.5" aria-hidden />
                              {isApproved(approved, v) ? "Approved" : "Approve"}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyText(v.text ?? "", `${g.id}-${idx}`)}
                              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                            >
                              {copiedKey === `${g.id}-${idx}` ? (
                                <>
                                  <Check className="h-3 w-3" aria-hidden /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" aria-hidden /> Copy
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{v.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
