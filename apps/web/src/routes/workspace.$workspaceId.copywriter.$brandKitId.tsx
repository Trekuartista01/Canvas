import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCopyGenerationJob } from "@/hooks/use-copy-generation-job";
import { base64ToBlob, uploadCopyAttachment } from "@/lib/copywriter-upload";
import { downscaleImage } from "@/lib/downscale-image";
import { extractFrames } from "@/lib/extract-frames";
import { trpc } from "@/lib/trpc";
import {
  COPY_LANGUAGES,
  COPY_LENGTHS,
  COPY_TYPES,
  type CopyLanguage,
  type CopyLength,
} from "@canvas/shared";
import { createRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Copy,
  CornerDownLeft,
  Film,
  FolderInput,
  RefreshCw,
  Sparkles,
  ThumbsUp,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const copywriterWorkspaceRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/copywriter/$brandKitId",
  component: CopywriterWorkspacePage,
});

const LENGTH_LABELS: Record<CopyLength, { label: string; hint: string }> = {
  short: { label: "Short", hint: "1 punchy line" },
  medium: { label: "Medium", hint: "headline + subtext" },
  long: { label: "Long", hint: "full caption w/ hashtags" },
};

const LANGUAGE_LABELS: Record<CopyLanguage, string> = { sq: "Shqip", en: "English", both: "Both" };

const REFINE_PRESETS = ["Shorter", "Punchier", "More formal", "Less salesy"];

type Variant = { label: string; text?: string; design_copy?: string; caption?: string };

function CopywriterWorkspacePage() {
  const { workspaceId, brandKitId } = copywriterWorkspaceRoute.useParams();
  const utils = trpc.useUtils();
  const brandKit = trpc.brandKit.get.useQuery({ brandKitId });

  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[] | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [frameAttachmentIds, setFrameAttachmentIds] = useState<string[] | null>(null);

  const [copyType, setCopyType] = useState<string>(COPY_TYPES[0]);
  const [length, setLength] = useState<CopyLength>("medium");
  const [language, setLanguage] = useState<CopyLanguage>("sq");
  const [extra, setExtra] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [refiningIdx, setRefiningIdx] = useState<number | null>(null);
  const [refineOpenIdx, setRefineOpenIdx] = useState<number | null>(null);
  const [refineText, setRefineText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (brandKit.data?.defaultCopyLanguage) {
      setLanguage(brandKit.data.defaultCopyLanguage as CopyLanguage);
    }
  }, [brandKit.data?.defaultCopyLanguage]);

  const { status } = useCopyGenerationJob(generationId ?? undefined, (event) => {
    if (event.status === "done") {
      void utils.copywriter.get.invalidate({ generationId: event.generationId });
      setRefiningIdx(null);
    } else if (event.status === "error") {
      setError(event.message ?? "Something went wrong. Try again.");
      setRefiningIdx(null);
    }
  });

  // The row's own status is the source of truth for a generate — WS events
  // are only a fast path. "queued" (published by the mutation) and usually
  // "generating" (worker pickup) both fire before this page's socket has
  // connected and been authorized, so polling covers any missed event.
  const generation = trpc.copywriter.get.useQuery(
    { generationId: generationId! },
    {
      enabled: !!generationId,
      refetchInterval: (query) => (query.state.data?.status === "pending" ? 1500 : false),
    },
  );

  useEffect(() => {
    if (generation.data?.status === "failed") {
      setError(generation.data.errorMessage ?? "Something went wrong. Try again.");
    }
  }, [generation.data?.status, generation.data?.errorMessage]);

  const generate = trpc.copywriter.generate.useMutation({
    onSuccess: (row) => setGenerationId(row.id),
    onError: (err) => setError(err.message),
  });

  const refine = trpc.copywriter.refine.useMutation({
    onError: (err) => {
      setError(err.message);
      setRefiningIdx(null);
    },
  });

  const approve = trpc.copywriter.approve.useMutation({
    onSuccess: (row) => utils.copywriter.get.setData({ generationId: row.id }, row),
  });

  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [savedDestination, setSavedDestination] = useState<string | null>(null);
  const saveToLibrary = trpc.copywriter.saveToLibrary.useMutation({
    onSuccess: (item, variables) => {
      setSavedIdx(variables.variantIndex);
      setSavedDestination(item.brandKitName);
    },
    onError: (err) => setError(err.message),
  });

  // Cmd+V: paste a copied artboard/screenshot straight from Photoshop or Figma
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        void handleFile(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  function resetResults() {
    setGenerationId(null);
    setRefineOpenIdx(null);
    setRefineText("");
    setSavedIdx(null);
    setSavedDestination(null);
  }

  async function handleFile(file: File) {
    setError(null);
    resetResults();

    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");
    if (!isImg && !isVid) {
      setError(
        "Please upload an image (PNG/JPG) or video (MP4/MOV). For PSD files, export as PNG first.",
      );
      return;
    }

    try {
      if (isImg) {
        const { dataUrl, base64 } = await downscaleImage(file);
        setMediaPreview(dataUrl);
        setFrames([base64]);
        setIsVideo(false);
      } else {
        setExtracting(true);
        const { frames: extracted, preview } = await extractFrames(file);
        setMediaPreview(preview);
        setFrames(extracted);
        setIsVideo(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setExtracting(false);
    }

    setFrameAttachmentIds(null);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function clearMedia() {
    setMediaPreview(null);
    setFrames(null);
    setFrameAttachmentIds(null);
    setIsVideo(false);
    resetResults();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function ensureFramesUploaded(): Promise<string[]> {
    if (frameAttachmentIds) return frameAttachmentIds;
    if (!frames) throw new Error("No design attached");
    const uploaded = await Promise.all(
      frames.map((base64, i) =>
        uploadCopyAttachment(workspaceId, base64ToBlob(base64), `frame-${i}.jpg`),
      ),
    );
    const ids = uploaded.map((u) => u.id);
    setFrameAttachmentIds(ids);
    return ids;
  }

  async function handleGenerate() {
    if (!frames || generate.isPending) return;
    setError(null);
    try {
      const ids = await ensureFramesUploaded();
      generate.mutate({
        workspaceId,
        brandKitId,
        copyType,
        length,
        language,
        frameAttachmentIds: ids,
        extra: extra.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    }
  }

  async function handleRefine(idx: number, instruction: string) {
    if (!instruction.trim() || refiningIdx !== null || !generationId) return;
    setRefiningIdx(idx);
    setError(null);
    // Refining changes this variant's content — any earlier "Saved" badge
    // no longer reflects what's on screen.
    if (savedIdx === idx) {
      setSavedIdx(null);
      setSavedDestination(null);
    }
    try {
      const ids = await ensureFramesUploaded();
      refine.mutate({
        generationId,
        variantIndex: idx,
        instruction: instruction.trim(),
        frameAttachmentIds: ids,
      });
      setRefineOpenIdx(null);
      setRefineText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refinement failed. Try again.");
      setRefiningIdx(null);
    }
  }

  function isApproved(v: Variant, approvedVariants: Variant[]) {
    return approvedVariants.some((a) => a.text === v.text);
  }

  // Approval state comes straight from the query cache (updated only once
  // the mutation actually succeeds) rather than local component state, so
  // the UI never shows "Approved" ahead of the server actually recording it.
  function toggleApprove(v: Variant, approvedVariants: Variant[]) {
    if (!generationId) return;
    const next = isApproved(v, approvedVariants)
      ? approvedVariants.filter((a) => a.text !== v.text)
      : [...approvedVariants, v];
    approve.mutate({ generationId, approved: next });
  }

  function copyText(text: string, key: string) {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  const loading =
    generate.isPending ||
    generation.data?.status === "pending" ||
    status === "queued" ||
    status === "generating";
  const variants = (generation.data?.variantsJson ?? []) as Variant[];
  const approvedVariants = (generation.data?.approvedJson ?? []) as Variant[];
  const hasResults = generation.data?.status === "completed" && variants.length > 0;

  return (
    <div className="space-y-6 p-6" data-testid="copywriter-workspace-page">
      <Link
        to="/w/$workspaceId/copywriter"
        params={{ workspaceId }}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        All brand kits
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-accent text-xs font-semibold tracking-wide uppercase">
            {brandKit.data?.name ?? "…"}
          </p>
          <h1 className="text-lg font-semibold">Generate copy</h1>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* LEFT: upload + controls */}
        <div className="space-y-4">
          {!mediaPreview ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => !extracting && fileInputRef.current?.click()}
              className="border-border bg-card flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center"
              data-testid="copywriter-dropzone"
            >
              {extracting ? (
                <>
                  <RefreshCw className="text-accent h-5 w-5 animate-spin" aria-hidden />
                  <p className="text-muted-foreground text-sm">Extracting video frames…</p>
                </>
              ) : (
                <>
                  <Upload className="text-accent h-6 w-6" aria-hidden />
                  <p className="text-sm font-medium">
                    Drop a design, paste (Cmd+V), or click to upload
                  </p>
                  <p className="text-muted-foreground text-xs">
                    PNG / JPG for images · MP4 / MOV for video (max 30s)
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                data-testid="copywriter-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </div>
          ) : (
            <div className="bg-card relative overflow-hidden rounded-md">
              <img
                src={mediaPreview}
                alt={isVideo ? "Video frame preview" : "Uploaded design"}
                className="max-h-[300px] w-full object-contain"
              />
              {isVideo && (
                <span className="bg-background/80 text-accent absolute top-2 left-2 flex items-center gap-1.5 rounded-full px-2 py-1 text-xs">
                  <Film className="h-3 w-3" aria-hidden />
                  Video · {frames?.length ?? 0} frames extracted
                </span>
              )}
              <button
                type="button"
                onClick={clearMedia}
                aria-label="Remove media"
                title="Remove media"
                className="bg-background/80 absolute top-2 right-2 rounded-full p-1.5"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          <Card className="space-y-4 p-4">
            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase">
                Copy type
              </p>
              <div className="flex flex-wrap gap-2">
                {COPY_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCopyType(t)}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      copyType === t
                        ? "bg-accent text-accent-foreground border-accent"
                        : "border-border bg-background"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase">
                {copyType === "Design copy + caption" ? "Caption length" : "Length"}
              </p>
              <div className="flex gap-2">
                {COPY_LENGTHS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLength(l)}
                    className={`flex-1 rounded-md border px-3 py-2 text-left ${
                      length === l
                        ? "bg-accent text-accent-foreground border-accent"
                        : "border-border bg-background"
                    }`}
                  >
                    <div className="text-xs font-semibold">{LENGTH_LABELS[l].label}</div>
                    <div className="text-[10px] opacity-70">{LENGTH_LABELS[l].hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase">Language</p>
              <div className="flex gap-2">
                {COPY_LANGUAGES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLanguage(l)}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      language === l
                        ? "bg-accent text-accent-foreground border-accent"
                        : "border-border bg-background"
                    }`}
                  >
                    {LANGUAGE_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="copywriter-extra"
                className="text-muted-foreground mb-1.5 block text-xs font-medium uppercase"
              >
                Extra instructions (optional)
              </label>
              <textarea
                id="copywriter-extra"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="e.g. this is a Ramadan campaign, mention the discount code SAVE20…"
                rows={2}
                className="border-border bg-background w-full resize-none rounded-md border px-3 py-2 text-sm outline-none"
              />
            </div>

            <Button
              type="button"
              className="w-full gap-2"
              disabled={!frames || loading}
              onClick={() => void handleGenerate()}
              data-testid="copywriter-generate"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                  Writing as {brandKit.data?.name}…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Generate copy
                </>
              )}
            </Button>
          </Card>
        </div>

        {/* RIGHT: results */}
        <div className="space-y-3">
          {error && (
            <div className="bg-status-critical/10 text-status-critical flex items-start gap-2 rounded-md p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </div>
          )}

          {!generationId && !loading && (
            <Card className="text-muted-foreground flex min-h-[300px] flex-col items-center justify-center gap-2 p-8 text-center text-sm">
              Upload a design and hit generate — copy in {brandKit.data?.name ?? "this brand"}'s
              voice shows up here
            </Card>
          )}

          {loading && (
            <Card className="flex min-h-[300px] flex-col items-center justify-center gap-3 p-8">
              <RefreshCw className="text-accent h-5 w-5 animate-spin" aria-hidden />
              <p className="text-muted-foreground text-sm">
                Reading the design and matching brand voice…
              </p>
            </Card>
          )}

          {hasResults && (
            <div className="space-y-3">
              {generation.data?.designRead && (
                <p className="bg-card rounded-md p-3 text-sm italic opacity-80">
                  "{generation.data.designRead}"
                </p>
              )}

              {variants.map((v, idx) => (
                <Card key={idx} className="space-y-3 p-4" data-testid={`copywriter-variant-${idx}`}>
                  <div className="flex items-center justify-between">
                    <span className="bg-muted text-accent rounded-full px-2.5 py-1 text-xs uppercase">
                      {v.label}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        title="Approve — teaches the tool this brand's real voice"
                        onClick={() => toggleApprove(v, approvedVariants)}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                          isApproved(v, approvedVariants)
                            ? "bg-accent text-accent-foreground border-accent"
                            : "border-border"
                        }`}
                      >
                        <ThumbsUp className="h-3 w-3" aria-hidden />
                        {isApproved(v, approvedVariants) ? "Approved" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyText(v.text ?? "", String(idx))}
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                      >
                        {copiedKey === String(idx) ? (
                          <>
                            <Check className="h-3 w-3" aria-hidden /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" aria-hidden /> Copy
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        title="Save to Library — files this copy under Copy / this brand kit"
                        disabled={saveToLibrary.isPending || !generationId}
                        onClick={() =>
                          generationId && saveToLibrary.mutate({ generationId, variantIndex: idx })
                        }
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs disabled:opacity-40"
                        data-testid={`copywriter-save-to-library-${idx}`}
                      >
                        {savedIdx === idx ? (
                          <>
                            <Check className="h-3 w-3" aria-hidden /> Saved
                          </>
                        ) : (
                          <>
                            <FolderInput className="h-3 w-3" aria-hidden /> Save to Library
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {savedIdx === idx && savedDestination && (
                    <p className="text-muted-foreground text-[11px]">
                      Saved to Library → Copy / {savedDestination}
                    </p>
                  )}

                  {v.design_copy || v.caption ? (
                    <div className="space-y-2">
                      {v.design_copy && (
                        <div className="bg-muted rounded-md p-3">
                          <p className="text-muted-foreground mb-1 text-[10px] uppercase">
                            On the design
                          </p>
                          <p className="text-base font-semibold">{v.design_copy}</p>
                        </div>
                      )}
                      {v.caption && (
                        <div className="bg-muted rounded-md p-3">
                          <p className="text-muted-foreground mb-1 text-[10px] uppercase">
                            Caption
                          </p>
                          <p className="text-sm whitespace-pre-wrap">{v.caption}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{v.text}</p>
                  )}

                  <div className="border-border flex flex-wrap items-center gap-1.5 border-t pt-3">
                    {refiningIdx === idx ? (
                      <span className="text-muted-foreground flex items-center gap-2 text-xs">
                        <RefreshCw className="text-accent h-3 w-3 animate-spin" aria-hidden />
                        Refining…
                      </span>
                    ) : (
                      <>
                        <Wand2 className="text-muted-foreground h-3 w-3" aria-hidden />
                        {REFINE_PRESETS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            disabled={refiningIdx !== null}
                            onClick={() => void handleRefine(idx, p)}
                            className="border-border rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-30"
                          >
                            {p}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={refiningIdx !== null}
                          onClick={() => {
                            setRefineOpenIdx(refineOpenIdx === idx ? null : idx);
                            setRefineText("");
                          }}
                          className={`rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-30 ${
                            refineOpenIdx === idx
                              ? "bg-accent text-accent-foreground border-accent"
                              : "border-border"
                          }`}
                        >
                          Custom…
                        </button>
                      </>
                    )}
                    {refineOpenIdx === idx && refiningIdx === null && (
                      <div className="mt-2 flex w-full items-center gap-2">
                        <input
                          autoFocus
                          value={refineText}
                          onChange={(e) => setRefineText(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && void handleRefine(idx, refineText)}
                          placeholder="e.g. mention the summer collection, drop the pun…"
                          className="border-border bg-background flex-1 rounded-md border px-3 py-1.5 text-xs outline-none"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={!refineText.trim()}
                          onClick={() => void handleRefine(idx, refineText)}
                          className="gap-1"
                        >
                          <CornerDownLeft className="h-3 w-3" aria-hidden />
                          Go
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
