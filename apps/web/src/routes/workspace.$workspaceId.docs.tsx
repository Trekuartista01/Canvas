import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const docsListRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/docs",
  component: DocsListPage,
});

function DocsListPage() {
  const { workspaceId } = docsListRoute.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const docs = trpc.doc.list.useQuery({ workspaceId });
  const create = trpc.doc.create.useMutation({
    onSuccess: (doc) => {
      void utils.doc.list.invalidate({ workspaceId });
      void navigate({
        to: "/w/$workspaceId/docs/$docId",
        params: { workspaceId, docId: doc.id },
      });
    },
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate({
      workspaceId,
      title: title.trim() || "Untitled",
    });
    setTitle("");
  }

  return (
    <div className="space-y-4 p-6" data-testid="docs-list-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Docs</h1>
            <p className="text-muted-foreground text-xs">
              Write and collaborate in real time, linked to your tasks.
            </p>
          </div>
        </div>
        {!creating && (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="docs-new"
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New doc
          </Button>
        )}
      </div>

      {creating && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>New doc</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <Input
                autoFocus
                data-testid="docs-new-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New doc title"
                className="h-8 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={create.isPending}
                  data-testid="docs-create"
                >
                  {create.isPending ? "Creating…" : "Create doc"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCreating(false);
                    setTitle("");
                  }}
                >
                  Cancel
                </Button>
              </div>
              {create.error && <p className="text-xs text-red-500">{create.error.message}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {docs.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (docs.data?.length ?? 0) === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          No docs yet. Create one to collaborate.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.data?.map((doc) => (
            <Link
              key={doc.id}
              to="/w/$workspaceId/docs/$docId"
              params={{ workspaceId, docId: doc.id }}
              data-testid={`docs-link-${doc.id}`}
            >
              <Card className="hover:border-accent flex items-start gap-3 p-4 transition-colors">
                <span className="bg-accent-soft text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                  <FileText className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="text-muted-foreground text-xs">
                    Updated {new Date(doc.updatedAt).toLocaleString()}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
