import { describe, expect, it } from "vitest";
import { checkStatusTransition, type TransitionContext } from "./task-transition-rules";

const base: TransitionContext = {
  from: "active",
  to: "review",
  listHasReview: true,
  isAssignee: true,
  isApprover: false,
  requiresProof: false,
  proofCount: 0,
};
const ok = { ok: true };

describe("checkStatusTransition (M7.2 lifecycle)", () => {
  it("lets an assignee submit for review", () => {
    expect(checkStatusTransition(base)).toEqual(ok);
    expect(checkStatusTransition({ ...base, from: "open" })).toEqual(ok);
  });

  it("doesn't let a non-assignee, non-approver submit", () => {
    expect(checkStatusTransition({ ...base, isAssignee: false })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("requires a proof photo when the task requires proof", () => {
    expect(checkStatusTransition({ ...base, requiresProof: true })).toMatchObject({
      ok: false,
      code: "BAD_REQUEST",
    });
    expect(checkStatusTransition({ ...base, requiresProof: true, proofCount: 1 })).toEqual(ok);
    // Even an approver submitting on someone's behalf needs the proof.
    expect(
      checkStatusTransition({ ...base, isAssignee: false, isApprover: true, requiresProof: true }),
    ).toMatchObject({ ok: false, code: "BAD_REQUEST" });
  });

  it("only lets an approver complete (approve) a task", () => {
    const approve = { ...base, from: "review" as const, to: "done" as const };
    expect(checkStatusTransition(approve)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(checkStatusTransition({ ...approve, isApprover: true })).toEqual(ok);
    expect(checkStatusTransition({ ...approve, to: "closed" })).toMatchObject({ ok: false });
  });

  it("doesn't let an assignee skip review by completing directly", () => {
    expect(checkStatusTransition({ ...base, to: "done" })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    // A manager may close work out directly.
    expect(checkStatusTransition({ ...base, to: "done", isApprover: true })).toEqual(ok);
  });

  it("sends review back to in progress only via Reject", () => {
    const back = { ...base, from: "review" as const, to: "active" as const, isApprover: true };
    expect(checkStatusTransition(back)).toMatchObject({ ok: false, code: "BAD_REQUEST" });
    expect(checkStatusTransition({ ...back, viaReject: true })).toEqual(ok);
    expect(checkStatusTransition({ ...back, to: "open" })).toMatchObject({ ok: false });
  });

  it("only lets an approver reopen completed work", () => {
    const reopen = { ...base, from: "done" as const, to: "active" as const };
    expect(checkStatusTransition(reopen)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(checkStatusTransition({ ...reopen, isApprover: true })).toEqual(ok);
  });

  it("allows free moves between pending and in progress", () => {
    const move = { ...base, from: "open" as const, to: "active" as const, isAssignee: false };
    expect(checkStatusTransition(move)).toEqual(ok);
    expect(checkStatusTransition({ ...move, from: "active", to: "open" })).toEqual(ok);
  });

  it("doesn't gate lists without a review status (pre-M7.2 lists)", () => {
    const legacy = { ...base, listHasReview: false, isAssignee: false };
    expect(checkStatusTransition({ ...legacy, from: "open", to: "done" })).toEqual(ok);
    expect(checkStatusTransition({ ...legacy, from: "done", to: "open" })).toEqual(ok);
  });

  it("treats a no-op move as allowed", () => {
    expect(checkStatusTransition({ ...base, from: "done", to: "done" })).toEqual(ok);
  });
});
