import { flattenImageVersionTree, type ImageVersionTreeNode } from "@canvas/shared";
import { ImageVersionThumb } from "@/components/image-version-thumb";

type VersionRow = {
  id: string;
  parentVersionId: string | null;
  createdAt: Date | string;
  blurhash: string | null;
  source: string;
};

export function VersionTreeSidebar({
  roots,
  selectedVersionId,
  currentVersionId,
  compareVersionId,
  onSelect,
  onToggleCompare,
}: {
  roots: ImageVersionTreeNode<VersionRow>[];
  selectedVersionId: string | null;
  currentVersionId: string | null;
  compareVersionId: string | null;
  onSelect: (versionId: string) => void;
  onToggleCompare: (versionId: string) => void;
}) {
  const flat = flattenImageVersionTree(roots);

  return (
    <div data-testid="generation-version-tree" className="space-y-2">
      <p className="text-xs font-medium">Version tree</p>
      <div data-testid="generation-variants" className="space-y-2">
        {flat.map((node) => {
          const isCurrent = currentVersionId === node.id;
          const isCompare = compareVersionId === node.id;
          return (
            <div
              key={node.id}
              className="flex items-start gap-2"
              style={{ paddingLeft: `${node.depth * 16}px` }}
              data-testid={`version-tree-row-${node.id}`}
              data-depth={node.depth}
              data-parent={node.parentVersionId ?? ""}
            >
              <ImageVersionThumb
                version={node}
                selected={selectedVersionId === node.id}
                onSelect={() => onSelect(node.id)}
              />
              <div className="min-w-0 flex-1 space-y-1 pt-1">
                <p className="text-muted-foreground truncate text-[12px]">
                  {node.source}
                  {isCurrent ? " · current" : ""}
                </p>
                <button
                  type="button"
                  data-testid={`version-compare-toggle-${node.id}`}
                  aria-pressed={isCompare}
                  onClick={() => onToggleCompare(node.id)}
                  className={`text-[12px] underline-offset-2 hover:underline ${
                    isCompare ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {isCompare ? "Comparing" : "Compare"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
