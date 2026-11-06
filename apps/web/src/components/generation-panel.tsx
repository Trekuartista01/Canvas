import {
  ASPECT_PRESETS,
  ASPECT_PRESET_LABELS,
  STYLE_PRESETS,
  STYLE_PRESET_LABELS,
  buildImageVersionTree,
  type AspectPreset,
  type StylePreset,
} from "@canvas/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageProofing } from "@/components/image-proofing";
import { ReferenceAttachZone, type AiReference } from "@/components/reference-attach-zone";
import { VersionCompare } from "@/components/version-compare";
import { VersionTreeSidebar } from "@/components/version-tree-sidebar";
import { useImageAssetJob } from "@/hooks/use-image-asset-job";
import { trpc } from "@/lib/trpc";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  GitBranch,
  Images,
  Loader2,
  Paperclip,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

export function GenerationPanel({
  workspaceId,
  taskId,
  listId,
  onAskBrain,
  onClose,
}: {
  workspaceId: string;
  taskId?: string;
  /** The list generation was triggered from, if any — used to resolve the
   * space's own brand kit (see Brand Kits' space assignments) ahead of the
   * workspace default. */
  listId?: string;
  /** M4.4: opens the caller's task-context Brain panel for an image critique. */
  onAskBrain?: () => void;
  onClose?: () => void;
}) {
  const utils = trpc.useUtils();
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });
  const spaceId = listId ? tree.data?.lists.find((l) => l.id === listId)?.spaceId : undefined;
  const brandKits = trpc.brandKit.list.useQuery({ workspaceId });
  const [brandKitId, setBrandKitId] = useState("");
  const brand = trpc.brandKit.getEffective.useQuery({
    workspaceId,
    spaceId,
    brandKitId: brandKitId || undefined,
  });
  const folders = trpc.imageFolder.list.useQuery({ workspaceId });
  const [folderId, setFolderId] = useState("");

  const [prompt, setPrompt] = useState("");
  const [useCase, setUseCase] = useState("");
  const [mustHave, setMustHave] = useState("");
  const [avoid, setAvoid] = useState("");
  const [references, setReferences] = useState<AiReference[]>([]);
  const [size, setSize] = useState<AspectPreset>("square");
  const [style, setStyle] = useState<StylePreset | "">("");
  const [n, setN] = useState(2);
  const [useBrandPalette, setUseBrandPalette] = useState(false);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [targetVersionCount, setTargetVersionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // When true, the next job "done" selects the new tip; then cleared so the
  // user can pick an older node to branch/compare without being snapped back.
  const followTipAfterJob = useRef(false);

  const generate = trpc.imageAsset.generate.useMutation();
  const edit = trpc.imageAsset.edit.useMutation();
  const promote = trpc.imageAsset.promoteVersion.useMutation({
    onSuccess: () => {
      if (assetId) void utils.imageAsset.get.invalidate({ assetId });
    },
  });
  const attach = trpc.imageAsset.attachToTask.useMutation({
    onSuccess: () => {
      if (taskId) void utils.attachment.list.invalidate({ taskId });
    },
  });

  const { status: jobStatus, setStatus: setJobStatus } = useImageAssetJob(
    assetId ?? undefined,
    (event) => {
      if (event.status === "done" || event.status === "error") {
        if (assetId) void utils.imageAsset.get.invalidate({ assetId });
      }
    },
  );

  const asset = trpc.imageAsset.get.useQuery(
    { assetId: assetId ?? "" },
    {
      enabled: !!assetId,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return 1000;
        if (jobStatus === "queued" || jobStatus === "generating") return 1000;
        if (targetVersionCount > 0 && data.versions.length < targetVersionCount) return 1000;
        return false;
      },
    },
  );

  const versions = asset.data?.versions ?? [];
  const treeRoots = useMemo(
    () => buildImageVersionTree(asset.data?.versions ?? []),
    [asset.data?.versions],
  );

  useEffect(() => {
    if (targetVersionCount > 0 && versions.length >= targetVersionCount) {
      if (jobStatus === "queued" || jobStatus === "generating" || jobStatus === "idle") {
        setJobStatus("done");
      }
    }
  }, [versions.length, targetVersionCount, jobStatus, setJobStatus]);

  useEffect(() => {
    const currentId = asset.data?.currentVersionId ?? null;
    const versionList = asset.data?.versions ?? [];
    if (!asset.data) return;
    if (followTipAfterJob.current && jobStatus === "done" && currentId) {
      setSelectedVersionId(currentId);
      followTipAfterJob.current = false;
      return;
    }
    if (selectedVersionId && versionList.some((v) => v.id === selectedVersionId)) return;
    setSelectedVersionId(currentId ?? versionList.at(-1)?.id ?? null);
  }, [asset.data, selectedVersionId, jobStatus]);

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || generate.isPending) return;
    if (!useCase.trim() || !mustHave.trim()) {
      setError("Answer the clarifying questions (use + must-haves) before generating.");
      return;
    }
    const enriched = [
      text,
      `Use: ${useCase.trim()}`,
      `Must include: ${mustHave.trim()}`,
      avoid.trim() ? `Avoid: ${avoid.trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    setError(null);
    setAssetId(null);
    setSelectedVersionId(null);
    setCompareVersionId(null);
    setTargetVersionCount(n);
    setJobStatus("queued");
    followTipAfterJob.current = true;
    try {
      const created = await generate.mutateAsync({
        workspaceId,
        prompt: enriched,
        size,
        style: style || undefined,
        n,
        useBrandPalette,
        spaceId,
        brandKitId: brandKitId || undefined,
        folderId: folderId || undefined,
        referenceAttachmentIds: references.map((r) => r.id),
      });
      setAssetId(created.id);
      setReferences([]);
    } catch (err) {
      setJobStatus("error");
      setError(err instanceof Error ? err.message : "Generation failed to start.");
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    const instruction = editInstruction.trim();
    if (!assetId || !selectedVersionId || !instruction || edit.isPending) return;
    setError(null);
    setTargetVersionCount(versions.length + 1);
    setJobStatus("queued");
    followTipAfterJob.current = true;
    try {
      await edit.mutateAsync({
        assetId,
        parentVersionId: selectedVersionId,
        instruction,
      });
      setEditInstruction("");
    } catch {
      setJobStatus("error");
      setError("Edit failed to start.");
    }
  }

  const ready = versions.length > 0;
  const busy =
    jobStatus === "queued" || jobStatus === "generating" || generate.isPending || edit.isPending;
  const waiting =
    !!assetId && (busy || (targetVersionCount > 0 && versions.length < targetVersionCount));
  const isCurrentSelected =
    !!selectedVersionId && selectedVersionId === asset.data?.currentVersionId;

  const statusLabel =
    jobStatus === "queued"
      ? "Queued…"
      : jobStatus === "generating"
        ? "Generating…"
        : jobStatus === "done"
          ? "Done"
          : jobStatus === "error"
            ? "Error"
            : waiting
              ? `Working ${versions.length}/${Math.max(targetVersionCount, versions.length)}…`
              : null;

  const statusTone =
    jobStatus === "error"
      ? "text-status-critical"
      : jobStatus === "done"
        ? "text-status-good"
        : "text-accent";

  return (
    <div data-testid="generation-panel" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-8 w-8 items-center justify-center rounded-md">
            <Wand2 className="h-4 w-4" aria-hidden />
          </span>
          <h3 className="text-sm font-semibold">Generate image</h3>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <ReferenceAttachZone
            workspaceId={workspaceId}
            references={references}
            onChange={setReferences}
            disabled={busy}
            testId="generation-reference-zone"
          >
            <div className="px-2 pt-2">
              <label htmlFor="gen-prompt" className="mb-1 block text-xs font-medium">
                Prompt
              </label>
              <textarea
                id="gen-prompt"
                data-testid="generation-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="Describe the image you want… Drop a reference image/file/video here too."
                className="border-border focus-visible:ring-accent w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2"
              />
            </div>
          </ReferenceAttachZone>

          <div
            className="bg-card shadow-sm space-y-2 rounded-md border border-dashed p-3"
            data-testid="generation-clarify"
          >
            <p className="text-xs font-medium">A few details before we generate</p>
            <div>
              <label htmlFor="gen-use" className="mb-1 block text-[12px] font-medium">
                Where will this be used?
              </label>
              <input
                id="gen-use"
                data-testid="generation-use-case"
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="e.g. Instagram post, print flyer, website hero"
                className="border-border h-8 w-full rounded-md border bg-transparent px-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="gen-must" className="mb-1 block text-[12px] font-medium">
                What must appear?
              </label>
              <input
                id="gen-must"
                data-testid="generation-must-have"
                value={mustHave}
                onChange={(e) => setMustHave(e.target.value)}
                placeholder="e.g. Zone Club logo, warm sunset, no people"
                className="border-border h-8 w-full rounded-md border bg-transparent px-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="gen-avoid" className="mb-1 block text-[12px] font-medium">
                Anything to avoid? (optional)
              </label>
              <input
                id="gen-avoid"
                data-testid="generation-avoid"
                value={avoid}
                onChange={(e) => setAvoid(e.target.value)}
                placeholder="e.g. neon colors, stock-photo look"
                className="border-border h-8 w-full rounded-md border bg-transparent px-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="gen-size" className="mb-1 block text-xs font-medium">
                Aspect ratio
              </label>
              <select
                id="gen-size"
                data-testid="generation-size"
                value={size}
                onChange={(e) => setSize(e.target.value as AspectPreset)}
                className="border-border bg-background h-8 w-full rounded border text-sm"
              >
                {ASPECT_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {ASPECT_PRESET_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="gen-style" className="mb-1 block text-xs font-medium">
                Style
              </label>
              <select
                id="gen-style"
                data-testid="generation-style"
                value={style}
                onChange={(e) => setStyle(e.target.value as StylePreset | "")}
                className="border-border bg-background h-8 w-full rounded border text-sm"
              >
                <option value="">Any style</option>
                {STYLE_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {STYLE_PRESET_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(brandKits.data?.length ?? 0) > 0 && (
            <div>
              <label htmlFor="gen-brand-kit" className="mb-1 block text-xs font-medium">
                Brand kit
              </label>
              <select
                id="gen-brand-kit"
                data-testid="generation-brand-kit"
                value={brandKitId}
                onChange={(e) => setBrandKitId(e.target.value)}
                className="border-border bg-background h-8 w-full rounded border text-sm"
              >
                <option value="">Auto (workspace/space default)</option>
                {brandKits.data?.map((kit) => (
                  <option key={kit.id} value={kit.id}>
                    {kit.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(folders.data?.filter((f) => f.kind === "custom").length ?? 0) > 0 && (
            <div>
              <label htmlFor="gen-folder" className="mb-1 block text-xs font-medium">
                Save to folder
              </label>
              <select
                id="gen-folder"
                data-testid="generation-folder"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="border-border bg-background h-8 w-full rounded border text-sm"
              >
                <option value="">Library (no folder)</option>
                {folders.data
                  ?.filter((folder) => folder.kind === "custom")
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="gen-n" className="mb-1 block text-xs font-medium">
                How many versions to create
              </label>
              <select
                id="gen-n"
                data-testid="generation-n"
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="border-border bg-background h-8 w-full rounded border text-sm"
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  data-testid="generation-use-brand"
                  checked={useBrandPalette}
                  onChange={(e) => setUseBrandPalette(e.target.checked)}
                />
                Use brand colors
                {(brand.data?.paletteJson?.length ?? 0) === 0 && (
                  <span className="text-muted-foreground">(none set yet)</span>
                )}
              </label>
            </div>
          </div>

          <Button
            type="button"
            onClick={handleGenerate}
            size="sm"
            disabled={!prompt.trim() || generate.isPending}
            data-testid="generation-submit"
            className="w-full gap-1.5"
          >
            {generate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            {generate.isPending ? "Starting…" : "Generate"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p className="text-status-critical text-sm" role="alert">
          {error}
        </p>
      )}

      {statusLabel && (
        <p
          data-testid="generation-job-status"
          data-status={jobStatus === "idle" && waiting ? "generating" : jobStatus}
          className={`flex items-center gap-1.5 text-sm font-medium ${statusTone}`}
        >
          {jobStatus === "done" ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          ) : jobStatus === "error" ? (
            <X className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          )}
          {statusLabel}
        </p>
      )}

      {ready && (
        <div className="space-y-4">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="text-status-good h-3.5 w-3.5" aria-hidden />
            Saved in Canvas —{" "}
            <Link
              to="/w/$workspaceId/library"
              params={{ workspaceId }}
              className="text-accent inline-flex items-center gap-1 hover:underline"
            >
              <Images className="h-3 w-3" aria-hidden />
              view in Library
            </Link>
          </p>

          <VersionTreeSidebar
            roots={treeRoots}
            selectedVersionId={selectedVersionId}
            currentVersionId={asset.data?.currentVersionId ?? null}
            compareVersionId={compareVersionId}
            onSelect={setSelectedVersionId}
            onToggleCompare={(versionId) => {
              setCompareVersionId((prev) => (prev === versionId ? null : versionId));
            }}
          />

          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="generation-promote"
            disabled={!assetId || !selectedVersionId || isCurrentSelected || promote.isPending}
            className="gap-1.5"
            onClick={() => {
              if (!assetId || !selectedVersionId) return;
              promote.mutate({ assetId, versionId: selectedVersionId });
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {isCurrentSelected ? "Current version" : "Set as current"}
          </Button>

          {selectedVersionId && compareVersionId && compareVersionId !== selectedVersionId && (
            <VersionCompare
              leftVersionId={selectedVersionId}
              rightVersionId={compareVersionId}
              onClear={() => setCompareVersionId(null)}
            />
          )}

          {selectedVersionId && (
            <ImageProofing versionId={selectedVersionId} taskId={taskId} onAskBrain={onAskBrain} />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <GitBranch className="h-4 w-4" aria-hidden />
                Edit the selected version
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <textarea
                id="gen-edit"
                aria-label="Describe the change"
                data-testid="generation-edit-instruction"
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                rows={2}
                placeholder="Describe the change you want, e.g. make the background darker…"
                disabled={!selectedVersionId || edit.isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleEdit(e);
                  }
                }}
                className="border-border focus-visible:ring-accent w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
              />
              <Button
                type="button"
                onClick={handleEdit}
                size="sm"
                variant="outline"
                disabled={!selectedVersionId || !editInstruction.trim() || edit.isPending || busy}
                data-testid="generation-edit-submit"
                className="gap-1.5"
              >
                {edit.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <GitBranch className="h-3.5 w-3.5" aria-hidden />
                )}
                {edit.isPending ? "Starting…" : "Create edited version"}
              </Button>
            </CardContent>
          </Card>

          {taskId && asset.data?.currentVersionId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="generation-attach"
              disabled={attach.isPending || busy}
              className="gap-1.5"
              onClick={() => {
                if (!assetId) return;
                attach.mutate({ assetId, taskId });
              }}
            >
              {attach.isSuccess ? (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Paperclip className="h-3.5 w-3.5" aria-hidden />
              )}
              {attach.isSuccess ? "Attached to task" : "Attach current version to task"}
            </Button>
          )}

          {asset.data?.altText && (
            <Card data-testid="generation-understanding">
              <CardContent className="space-y-1 pt-4">
                <p className="text-xs font-medium">What Brain sees in this image</p>
                <p data-testid="generation-alt-text" className="text-muted-foreground text-sm">
                  {asset.data.altText}
                </p>
                {Array.isArray(asset.data.tagsJson) && asset.data.tagsJson.length > 0 && (
                  <p data-testid="generation-tags" className="text-muted-foreground text-xs">
                    Tags: {asset.data.tagsJson.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
