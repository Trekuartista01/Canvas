import { usePrivateUpload } from "@/hooks/use-private-upload";
import { trpc } from "@/lib/trpc";

/**
 * M7.5: a supporting document for a leave request (e.g. a doctor's note) —
 * private to the employee and their approvers (leave.presignDocument /
 * confirmDocument).
 */
export function useLeaveDocumentUpload(workspaceId: string) {
  return usePrivateUpload(
    workspaceId,
    trpc.leave.presignDocument.useMutation(),
    trpc.leave.confirmDocument.useMutation(),
  );
}
