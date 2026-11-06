import { GlobalSearch } from "@/components/global-search";
import { ImageVersionThumb } from "@/components/image-version-thumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { createRoute, Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const semanticSearchRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/semantic-search",
  component: SemanticSearchPage,
});

function SemanticSearchPage() {
  const { workspaceId } = semanticSearchRoute.useParams();

  return (
    <div className="space-y-6 p-6" data-testid="semantic-search-page">
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">Smart search</h1>
      </div>

      <GlobalSearch workspaceId={workspaceId} />
      <TaskSemanticSearch workspaceId={workspaceId} />
      <VisualSearch workspaceId={workspaceId} />
    </div>
  );
}

function TaskSemanticSearch({ workspaceId }: { workspaceId: string }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const results = trpc.search.tasksByText.useQuery(
    { workspaceId, query },
    { enabled: query.length > 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search tasks by meaning</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Finds tasks by what they're about, not just exact word matches — describe what you're
          looking for in your own words.
        </p>
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
            placeholder="e.g. onboarding paperwork for new hires"
            className="h-8 text-sm"
            data-testid="semantic-search-input"
          />
          <Button type="submit" size="sm" disabled={!input.trim()}>
            Search
          </Button>
        </form>

        {query.length > 0 && (
          <div data-testid="semantic-search-results">
            {results.isLoading && <p className="text-muted-foreground text-xs">Searching…</p>}
            {!results.isLoading && (results.data?.length ?? 0) === 0 && (
              <p className="text-muted-foreground text-xs">No embedded tasks match yet.</p>
            )}
            <ul className="divide-border divide-y rounded-md border">
              {results.data?.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/w/$workspaceId/l/$listId"
                    params={{ workspaceId, listId: r.listId }}
                    search={{ openTask: r.id }}
                    className="hover:bg-muted block px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{r.title}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {r.spaceName} / {r.listName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VisualSearch({ workspaceId }: { workspaceId: string }) {
  const assets = trpc.imageAsset.list.useQuery({ workspaceId });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const similar = trpc.search.imagesLikeThis.useQuery(
    { imageAssetId: selectedId ?? "" },
    { enabled: selectedId !== null },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Find images like this</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Pick an image below to find visually/conceptually similar ones, compared by their
          AI-generated alt-text and tags.
        </p>

        {(assets.data?.length ?? 0) === 0 ? (
          <p className="text-muted-foreground text-xs">No images yet — generate or upload one.</p>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="visual-search-picker">
            {assets.data?.map((asset) => (
              <ImageVersionThumb
                key={asset.id}
                version={{ id: asset.currentVersionId ?? asset.id, blurhash: asset.blurhash }}
                selected={asset.id === selectedId}
                onSelect={() => setSelectedId(asset.id)}
              />
            ))}
          </div>
        )}

        {selectedId && (
          <div className="border-border border-t pt-3">
            <p className="mb-2 text-xs font-medium">Similar images</p>
            {similar.isLoading && <p className="text-muted-foreground text-xs">Searching…</p>}
            {similar.isError && (
              <p className="text-muted-foreground text-xs">{similar.error.message}</p>
            )}
            {similar.data?.length === 0 && (
              <p className="text-muted-foreground text-xs">No other analyzed images yet.</p>
            )}
            <div className="flex flex-wrap gap-2" data-testid="visual-search-results">
              {similar.data?.map((r) => (
                <ImageVersionThumb
                  key={r.id}
                  version={{ id: r.currentVersionId ?? r.id, blurhash: r.blurhash }}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
