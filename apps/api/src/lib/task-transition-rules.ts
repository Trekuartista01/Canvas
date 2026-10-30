import type { StatusKind } from "@canvas/shared";

/**
 * M7.2 task lifecycle: pending (open) → in progress (active) → awaiting
 * approval (review) → completed (done). Pure, so every status-changing path
 * (task.update, board drag, bulk edit, quick-complete, submit/approve/
 * reject) shares one tested rulebook. The DB-backed wrapper that builds the
 * context lives in task-transition.ts.
 *
 * Only lists that actually have a review-kind status are gated — legacy
 * lists created before M7.2 keep their old free-form behaviour.
 */
export interface TransitionContext {
  from: StatusKind;
  to: StatusKind;
  listHasReview: boolean;
  isAssignee: boolean;
  /** tasks:manageTeam — creator, assignee's manager, ops manager, HR, super admin. */
  isApprover: boolean;
  requiresProof: boolean;
  proofCount: number;
  /** The move comes from task.reject, which already demanded a comment. */
  viaReject?: boolean;
}

export type TransitionResult =
  { ok: true } | { ok: false; code: "FORBIDDEN" | "BAD_REQUEST"; message: string };

const FINISHED = new Set<StatusKind>(["done", "closed"]);

export function checkStatusTransition(ctx: TransitionContext): TransitionResult {
  if (ctx.from === ctx.to || !ctx.listHasReview) return { ok: true };

  if (ctx.to === "review") {
    if (!ctx.isAssignee && !ctx.isApprover) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "Only an assignee can submit this task for approval",
      };
    }
    if (ctx.requiresProof && ctx.proofCount === 0) {
      return {
        ok: false,
        code: "BAD_REQUEST",
        message: "Attach a proof photo before submitting for approval",
      };
    }
    return { ok: true };
  }

  if (FINISHED.has(ctx.to)) {
    // Approving from review, or a manager closing work out directly.
    return ctx.isApprover
      ? { ok: true }
      : {
          ok: false,
          code: "FORBIDDEN",
          message: "This task needs approval — submit it for review instead",
        };
  }

  // to is open/active from here on.
  if (ctx.from === "review") {
    return ctx.viaReject
      ? { ok: true }
      : {
          ok: false,
          code: "BAD_REQUEST",
          message: "Use Reject (with a comment) to send a task back",
        };
  }
  if (FINISHED.has(ctx.from) && !ctx.isApprover) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only an approver can reopen a completed task",
    };
  }
  return { ok: true };
}
