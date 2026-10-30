import type { StatusKind } from "@canvas/shared";
import { BlurhashThumb } from "@/components/blurhash-thumb";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { trpc } from "@/lib/trpc";
import { useRef, useState } from "react";

/**
 * M7.2 approval flow in the task panel: who may do what is decided by
 * task.approvalState (server-side rules in lib/task-transition-rules.ts);
 * this only shows the matching controls. Proof photos sit here, above the
 * fold, because they're what an approver is judging.
 */
export function TaskApprovalSection({
  taskId,
  statusKind,
  requiresProof,
  onChanged,
}: {
  taskId: string;
  statusKind: StatusKind | undefined;
  requiresProof: boolean;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const state = trpc.task.approvalState.useQuery({ taskId });
  const attachments = trpc.attachment.list.useQuery({ taskId });
  const proofs = (attachments.data ?? []).filter((a) => a.isProof);

  const afterChange = () => {
    onChanged();
    void utils.task.approvalState.invalidate({ taskId });
    void utils.task.listMine.invalidate();
  };
  const submit = trpc.task.submitForReview.useMutation({ onSuccess: afterChange });
  const approve = trpc.task.approve.useMutation({ onSuccess: afterChange });
  const reject = trpc.task.reject.useMutation({
    onSuccess: () => {
      setRejecting(false);
      setRejectComment("");
      afterChange();
      void utils.comment.list.invalidate({ taskId });
    },
  });
  const [rejecting, setRejecting] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  if (!state.data?.hasReviewStatus) return null;
  const { isAssignee, isApprover } = state.data;
  const inReview = statusKind === "review";
  const finished = statusKind === "done" || statusKind === "closed";
  const error = submit.error ?? approve.error ?? reject.error;

  return (
    <section
      className="border-border space-y-3 rounded-md border p-3"
      data-testid="task-approval"
      aria-label="Approval"
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold">Approval</span>
        {inReview && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
            Awaiting approval
          </span>
        )}
        {finished && (
          <span className="text-status-good rounded-full px-2 py-0.5 text-xs">Approved</span>
        )}
        {requiresProof && (
          <span className="bg-muted ml-auto rounded-full px-2 py-0.5 text-xs">Proof required</span>
        )}
      </div>

      <ProofPhotos taskId={taskId} proofs={proofs} canUpload={!finished} onUploaded={afterChange} />

      {!inReview && !finished && (isAssignee || isApprover) && (
        <div className="space-y-1">
          <Button
            size="sm"
            onClick={() => submit.mutate({ taskId })}
            disabled={submit.isPending || (requiresProof && proofs.length === 0)}
            data-testid="submit-for-review"
          >
            {submit.isPending ? "Submitting…" : "Submit for approval"}
          </Button>
          {requiresProof && proofs.length === 0 && (
            <p className="text-muted-foreground text-xs">Add a proof photo first.</p>
          )}
        </div>
      )}

      {inReview && !isApprover && (
        <p className="text-muted-foreground text-xs">Waiting for a manager to approve it.</p>
      )}

      {inReview && isApprover && !rejecting && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => approve.mutate({ taskId })}
            disabled={approve.isPending}
            data-testid="approve-task"
          >
            {approve.isPending ? "Approving…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRejecting(true)}
            data-testid="reject-task"
          >
            Reject
          </Button>
        </div>
      )}

      {inReview && isApprover && rejecting && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (rejectComment.trim()) reject.mutate({ taskId, comment: rejectComment.trim() });
          }}
        >
          <Textarea
            autoFocus
            required
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="What needs to change? (required)"
            aria-label="Reason for rejecting"
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!rejectComment.trim() || reject.isPending}
              data-testid="reject-confirm"
            >
              Send back
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error.message}
        </p>
      )}
    </section>
  );
}

function ProofPhotos({
  taskId,
  proofs,
  canUpload,
  onUploaded,
}: {
  taskId: string;
  proofs: { id: string; blurhash: string | null; fileName: string }[];
  canUpload: boolean;
  onUploaded: () => void;
}) {
  const utils = trpc.useUtils();
  const { uploadFile, progress } = useAttachmentUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploading = Object.keys(progress).length > 0;

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(file, { taskId }, { isProof: true });
      }
      await utils.attachment.list.invalidate({ taskId });
      onUploaded();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2" data-testid="task-proof">
      {proofs.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {proofs.map((p) => (
            <BlurhashThumb key={p.id} attachment={p} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">No proof photo yet.</p>
      )}
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            data-testid="proof-file-input"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Add proof photo"}
          </Button>
        </>
      )}
      {uploadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {uploadError}
        </p>
      )}
    </div>
  );
}
