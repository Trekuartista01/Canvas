import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLeaveDocumentUpload } from "@/hooks/use-leave-document-upload";
import { trpc } from "@/lib/trpc";
import { LEAVE_TYPE_LABELS, LEAVE_TYPES, type LeaveType } from "@canvas/shared";
import { useState, type FormEvent } from "react";

/**
 * M7.5 request form. Without `forUserId` the caller asks for their own
 * leave (pending until approved); with it, HR records leave for that person
 * (approved at once). Working days and any rule problem come live from
 * leave.preview — the server computes both, the form only shows them.
 */
export function LeaveForm({
  workspaceId,
  forUserId,
  onDone,
}: {
  workspaceId: string;
  forUserId?: string;
  onDone?: () => void;
}) {
  const utils = trpc.useUtils();
  const [type, setType] = useState<LeaveType>("vacation");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [document, setDocument] = useState<{ id: string; fileName: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { upload, progress } = useLeaveDocumentUpload(workspaceId);

  const datesSet = Boolean(startDate && endDate);
  const preview = trpc.leave.preview.useQuery(
    { workspaceId, type, startDate, endDate, userId: forUserId },
    { enabled: datesSet && (!forUserId || forUserId.length > 0) },
  );

  const reset = () => {
    setStartDate("");
    setEndDate("");
    setReason("");
    setDocument(null);
    void utils.leave.invalidate();
    onDone?.();
  };
  const request = trpc.leave.request.useMutation({ onSuccess: reset });
  const record = trpc.leave.record.useMutation({ onSuccess: reset });
  const mutation = forUserId ? record : request;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!datesSet) return;
    const payload = {
      workspaceId,
      type,
      startDate,
      endDate,
      reason: reason.trim() || undefined,
      documentAttachmentId: document?.id,
    };
    if (forUserId) record.mutate({ ...payload, userId: forUserId });
    else request.mutate(payload);
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    try {
      setDocument(await upload(file));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  const problem = preview.data?.problem ?? null;
  const prefix = forUserId ? "record" : "leave";

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3" data-testid={`${prefix}-form`}>
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <Label htmlFor={`${prefix}-type`} className="text-xs">
          Type
        </Label>
        <select
          id={`${prefix}-type`}
          value={type}
          onChange={(e) => setType(e.target.value as LeaveType)}
          className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
        >
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {LEAVE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="hidden sm:block" />
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-start`} className="text-xs">
          First day
        </Label>
        <Input
          id={`${prefix}-start`}
          type="date"
          required
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
          }}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-end`} className="text-xs">
          Last day
        </Label>
        <Input
          id={`${prefix}-end`}
          type="date"
          required
          min={startDate || undefined}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      <div className="col-span-2 space-y-1">
        <Label htmlFor={`${prefix}-reason`} className="text-xs">
          Note (optional)
        </Label>
        <Textarea
          id={`${prefix}-reason`}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="text-muted-foreground flex items-center gap-2">
          Supporting document (optional)
          <input
            type="file"
            aria-label="Supporting document"
            className="text-xs"
            onChange={(e) => void attach(e.target.files?.[0])}
          />
        </label>
        {progress !== null && <span>Uploading… {progress}%</span>}
        {document && <span className="text-muted-foreground">Attached: {document.fileName}</span>}
        {uploadError && <span className="text-red-600 dark:text-red-400">{uploadError}</span>}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="sm"
          disabled={!datesSet || !!problem || preview.isFetching || mutation.isPending}
          data-testid={`${prefix}-submit`}
        >
          {forUserId ? "Record leave" : "Request leave"}
        </Button>
        {datesSet && preview.data && (
          <span className="text-sm" data-testid={`${prefix}-preview`}>
            {preview.data.workingDays} working day{preview.data.workingDays === 1 ? "" : "s"}
            {type === "vacation" && !problem && (
              <span className="text-muted-foreground">
                {" "}
                · {preview.data.available} available in {preview.data.year}
              </span>
            )}
          </span>
        )}
        {problem && (
          <span className="text-sm text-red-600 dark:text-red-400" role="alert">
            {problem}
          </span>
        )}
        {mutation.error && (
          <span className="text-sm text-red-600 dark:text-red-400" role="alert">
            {mutation.error.message}
          </span>
        )}
      </div>
    </form>
  );
}
