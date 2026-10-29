import { Button } from "@/components/ui/button";
import { ReferenceAttachZone, type AiReference } from "@/components/reference-attach-zone";
import { useBrainStream } from "@/hooks/use-brain-stream";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import {
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

function messageText(contentJson: unknown): string {
  if (!contentJson || typeof contentJson !== "object") return "";
  const text = (contentJson as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function toolCallNames(contentJson: unknown): string[] {
  if (!contentJson || typeof contentJson !== "object") return [];
  const calls = (contentJson as { toolCalls?: unknown }).toolCalls;
  if (!Array.isArray(calls)) return [];
  return calls
    .map((c) =>
      c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string"
        ? (c as { name: string }).name
        : null,
    )
    .filter((n): n is string => !!n);
}

function toolResultLabel(contentJson: unknown): string {
  if (!contentJson || typeof contentJson !== "object") return "Tool result";
  const name = (contentJson as { name?: unknown }).name;
  return typeof name === "string" ? `Tool: ${name}` : "Tool result";
}

export function BrainChatPanel({
  workspaceId,
  contextType,
  contextId,
  onClose,
  onImageReady,
}: {
  workspaceId: string;
  contextType: "global" | "task" | "doc";
  contextId?: string;
  onClose: () => void;
  /** Doc Brain: insert a finished generation into the collaborative editor. */
  onImageReady?: (versionId: string) => void;
}) {
  const utils = trpc.useUtils();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [references, setReferences] = useState<AiReference[]>([]);
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { containerRef, onKeyDown } = useModalA11y(onClose);

  const brandKits = trpc.brandKit.list.useQuery({ workspaceId });
  const setBrandKit = trpc.brain.setBrandKit.useMutation();

  // Switching conversations (new chat, picking a history row, or the
  // active one getting deleted out from under us) all need the same
  // in-flight-message state cleared — otherwise a pending/streaming reply
  // from the old conversation would render under the new one.
  function resetComposerState() {
    setDraft("");
    setReferences([]);
    setPendingUserText(null);
    setStreamingText("");
    setStreamError(null);
    setStatusLine(null);
    setSending(false);
  }

  const conversationContext = {
    workspaceId,
    contextType,
    contextId: contextType === "global" ? undefined : contextId,
  };

  const getOrCreate = trpc.brain.getOrCreateConversation.useMutation({
    onSuccess: (conversation) => {
      setConversationId(conversation.id);
      setBrandKitId(conversation.brandKitId);
    },
  });

  useEffect(() => {
    getOrCreate.mutate(conversationContext);
    // Intentionally once per mount / context change — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-scoped
  }, [workspaceId, contextType, contextId]);

  const history = trpc.brain.list.useQuery({ workspaceId }, { enabled: showHistory });

  const newConversation = trpc.brain.newConversation.useMutation({
    onSuccess: (conversation) => {
      resetComposerState();
      setConversationId(conversation.id);
      setBrandKitId(conversation.brandKitId);
      setShowHistory(false);
      void utils.brain.list.invalidate({ workspaceId });
    },
  });

  const deleteConversation = trpc.brain.delete.useMutation({
    onSuccess: (_result, variables) => {
      void utils.brain.list.invalidate({ workspaceId });
      // Deleting the conversation currently open in this panel leaves
      // nothing to show it — start a fresh one so the panel keeps working.
      if (variables.conversationId === conversationId) {
        newConversation.mutate(conversationContext);
      }
    },
  });

  const messages = trpc.brain.messages.list.useQuery(
    { conversationId: conversationId ?? "" },
    { enabled: !!conversationId },
  );

  const send = trpc.brain.messages.send.useMutation();

  useBrainStream(conversationId, {
    onDelta: (text) => {
      setStreamingText((prev) => prev + text);
      setStreamError(null);
    },
    onDone: () => {
      setStreamingText("");
      setStatusLine(null);
      setSending(false);
      void (async () => {
        if (conversationId) {
          await utils.brain.messages.list.invalidate({ conversationId });
          await utils.brain.list.invalidate({ workspaceId });
          if (contextType === "task" && contextId) {
            await utils.attachment.list.invalidate({ taskId: contextId });
          }
        }
        setPendingUserText(null);
      })();
    },
    onError: (message) => {
      setStreamError(message);
      setStreamingText("");
      setStatusLine(null);
      setPendingUserText(null);
      setSending(false);
    },
    onToolStatus: (event) => {
      if (event.status === "running") setStatusLine(`Running ${event.name}…`);
      else if (event.status === "error")
        setStatusLine(`${event.name} failed${event.detail ? `: ${event.detail}` : ""}`);
      else setStatusLine(null);
    },
    onImageStatus: (event) => {
      if (event.status === "queued") setStatusLine("Image queued…");
      else if (event.status === "generating") setStatusLine("Generating image…");
      else if (event.status === "done") {
        setStatusLine("Image ready");
        if (event.versionId) onImageReady?.(event.versionId);
      } else if (event.status === "error")
        setStatusLine(event.message ?? "Image generation failed");
    },
  });

  function handleBrandKitChange(value: string) {
    const nextBrandKitId = value || null;
    setBrandKitId(nextBrandKitId);
    if (conversationId) {
      setBrandKit.mutate({ conversationId, brandKitId: nextBrandKitId });
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId || sending) return;

    const attachmentIds = references.map((r) => r.id);
    setDraft("");
    setReferences([]);
    setPendingUserText(text);
    setStreamingText("");
    setStreamError(null);
    setStatusLine(null);
    setSending(true);

    try {
      await send.mutateAsync({
        conversationId,
        text,
        referenceAttachmentIds: attachmentIds,
      });
    } catch (err) {
      setPendingUserText(null);
      setSending(false);
      setStreamError(err instanceof Error ? err.message : "Failed to send message.");
    }
  }

  const title =
    contextType === "task"
      ? "Brain — this task"
      : contextType === "doc"
        ? "Brain — this doc"
        : "Brain";

  const persistedMessages = messages.data ?? [];
  const pendingAlreadyPersisted =
    !!pendingUserText &&
    persistedMessages.some(
      (m) => m.role === "user" && messageText(m.contentJson) === pendingUserText,
    );
  const showPending = !!pendingUserText && !pendingAlreadyPersisted;

  return (
    <div data-testid="brain-chat-panel" className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Close Brain chat"
        title="Close Brain chat"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="border-border bg-background relative flex h-full w-full max-w-md flex-col border-l shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="bg-accent-soft text-accent flex h-8 w-8 items-center justify-center rounded-md">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => newConversation.mutate(conversationContext)}
              disabled={newConversation.isPending}
              aria-label="New conversation"
              title="New conversation"
              data-testid="brain-new-conversation"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory((v) => !v)}
              aria-label="Conversation history"
              title="Conversation history"
              aria-pressed={showHistory}
              data-testid="brain-history-toggle"
            >
              <History className="h-4 w-4" aria-hidden />
            </Button>
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
          </div>
        </div>

        {(brandKits.data?.length ?? 0) > 0 && (
          <div className="border-border flex items-center gap-2 border-b px-4 py-2 text-xs">
            <label htmlFor="brain-brand-kit" className="text-muted-foreground shrink-0">
              Brand
            </label>
            <select
              id="brain-brand-kit"
              data-testid="brain-brand-kit"
              value={brandKitId ?? ""}
              disabled={!conversationId}
              onChange={(e) => handleBrandKitChange(e.target.value)}
              className="border-border bg-background h-7 flex-1 rounded border px-1.5 text-xs"
            >
              <option value="">None</option>
              {brandKits.data?.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {showHistory ? (
          <div
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-4"
            data-testid="brain-history-list"
          >
            {history.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : (history.data?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No past conversations yet.
              </p>
            ) : (
              history.data?.map((c) => (
                <div
                  key={c.id}
                  data-testid={`brain-history-item-${c.id}`}
                  className="border-border hover:bg-muted flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => {
                      resetComposerState();
                      setConversationId(c.id);
                      setShowHistory(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate">{c.preview}</p>
                    <p className="text-muted-foreground text-[11px]">
                      {c.isActive && c.id === conversationId ? "Current · " : ""}
                      {new Date(c.createdAt).toLocaleString()}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConversation.mutate({ conversationId: c.id })}
                    aria-label="Delete conversation"
                    title="Delete conversation"
                    data-testid={`brain-history-delete-${c.id}`}
                    className="text-muted-foreground hover:text-status-critical shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {getOrCreate.isPending && !conversationId && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Opening conversation…
              </p>
            )}
            {getOrCreate.isError && (
              <p className="text-status-critical text-sm">Could not open Brain chat.</p>
            )}

            {persistedMessages.length === 0 &&
              !getOrCreate.isPending &&
              !showPending &&
              !streamingText &&
              !sending && (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  Ask Brain anything about this{" "}
                  {contextType === "global" ? "workspace" : contextType}.
                </p>
              )}

            {persistedMessages.map((m) => {
              if (m.role === "tool") {
                return (
                  <div
                    key={m.id}
                    data-testid="brain-message-tool"
                    className="text-muted-foreground mr-6 flex items-center gap-1.5 text-xs italic"
                  >
                    <Wrench className="h-3 w-3 shrink-0" aria-hidden />
                    {toolResultLabel(m.contentJson)}
                  </div>
                );
              }

              const text = messageText(m.contentJson);
              const tools = toolCallNames(m.contentJson);
              if (!text && tools.length === 0) return null;

              return (
                <div
                  key={m.id}
                  data-testid={`brain-message-${m.role}`}
                  className={
                    m.role === "user"
                      ? "bg-accent-soft ml-6 rounded-md px-3 py-2 text-sm"
                      : "border-border bg-card mr-6 rounded-md border px-3 py-2 text-sm"
                  }
                >
                  <p className="text-muted-foreground mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase">
                    {m.role !== "user" && <Sparkles className="h-2.5 w-2.5" aria-hidden />}
                    {m.role === "user" ? "You" : "Brain"}
                  </p>
                  {text && <p className="whitespace-pre-wrap">{text}</p>}
                  {(m.imageVersionIds?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.imageVersionIds!.map((versionId) => (
                        <img
                          key={versionId}
                          src={`/image-versions/${versionId}/thumb`}
                          alt=""
                          className="border-border h-12 w-12 rounded border object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {tools.length > 0 && (
                    <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                      <Wrench className="h-3 w-3" aria-hidden />
                      Used {tools.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}

            {showPending && (
              <div
                data-testid="brain-message-user-pending"
                className="bg-accent-soft ml-6 rounded-md px-3 py-2 text-sm opacity-80"
              >
                <p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
                  You
                </p>
                <p className="whitespace-pre-wrap">{pendingUserText}</p>
              </div>
            )}

            {(streamingText || (sending && !streamingText) || statusLine) && (
              <div
                data-testid="brain-message-assistant-streaming"
                className="border-border bg-card mr-6 rounded-md border px-3 py-2 text-sm"
              >
                <p className="text-muted-foreground mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase">
                  <Sparkles className="h-2.5 w-2.5" aria-hidden />
                  Brain
                </p>
                {statusLine && (
                  <p
                    data-testid="brain-status-line"
                    className="text-accent mb-1 flex items-center gap-1.5 text-xs"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {statusLine}
                  </p>
                )}
                <p className="whitespace-pre-wrap">
                  {streamingText || (sending && !statusLine ? "…" : "")}
                </p>
              </div>
            )}

            {streamError && (
              <p className="text-status-critical text-sm" role="alert">
                {streamError}
              </p>
            )}
          </div>
        )}

        {!showHistory && (
          <form onSubmit={handleSend} className="border-border border-t p-3">
            <ReferenceAttachZone
              workspaceId={workspaceId}
              references={references}
              onChange={setReferences}
              disabled={!conversationId || sending}
              testId="brain-reference-zone"
            >
              <label className="sr-only" htmlFor="brain-message-input">
                Message Brain
              </label>
              <textarea
                id="brain-message-input"
                data-testid="brain-message-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask Brain… Attach a reference image, file, or video."
                rows={3}
                disabled={!conversationId || sending}
                className="border-border focus-visible:ring-accent m-2 mb-0 w-[calc(100%-1rem)] resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend(e);
                  }
                }}
              />
            </ReferenceAttachZone>
            <div className="mt-2 flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={!conversationId || sending || !draft.trim()}
                className="gap-1.5"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden />
                )}
                Send
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
