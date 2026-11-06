import { describe, expect, it } from "vitest";
import {
  columnForStatusKind,
  columnStatusKind,
  filterBoardCards,
  isCardOverdue,
  statusForMove,
} from "./boards";

const TODAY = "2026-11-04";

describe("statusForMove", () => {
  const statuses = [
    { id: "open", kind: "open" },
    { id: "review", kind: "review" },
  ];

  it("keeps the same kind", () => {
    expect(statusForMove(statuses, "review")?.id).toBe("review");
  });

  it("falls back to the list's first status", () => {
    expect(statusForMove(statuses, "done")?.id).toBe("open");
  });

  it("is null for a list with no statuses", () => {
    expect(statusForMove([], "open")).toBeNull();
  });
});

describe("isCardOverdue", () => {
  it("is past the due date and not finished", () => {
    expect(isCardOverdue({ dueDate: "2026-11-03", statusKind: "open" }, TODAY)).toBe(true);
  });

  it("isn't overdue on the day itself", () => {
    expect(isCardOverdue({ dueDate: TODAY, statusKind: "open" }, TODAY)).toBe(false);
  });

  it("isn't overdue once finished, or with no date", () => {
    expect(isCardOverdue({ dueDate: "2026-11-03", statusKind: "done" }, TODAY)).toBe(false);
    expect(isCardOverdue({ dueDate: "2026-11-03", statusKind: "closed" }, TODAY)).toBe(false);
    expect(isCardOverdue({ dueDate: null, statusKind: "open" }, TODAY)).toBe(false);
  });
});

describe("filterBoardCards", () => {
  const card = (id: string, over: Partial<Parameters<typeof base>[0]> = {}) =>
    base({ ...over, id });
  function base(c: {
    id?: string;
    dueDate?: string | null;
    statusKind?: string;
    assignees?: { userId: string }[];
    tags?: { id: string }[];
  }) {
    return {
      id: c.id ?? "",
      dueDate: c.dueDate ?? null,
      statusKind: c.statusKind ?? "open",
      assignees: c.assignees ?? [],
      tags: c.tags ?? [],
    };
  }
  const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

  const cards = [
    card("late-sam", { dueDate: "2026-11-01", assignees: [{ userId: "sam" }] }),
    card("soon-tagged", { dueDate: "2026-11-11", tags: [{ id: "red" }] }),
    card("later", { dueDate: "2026-11-12" }),
    card("undated", {}),
    card("late-done", { dueDate: "2026-11-01", statusKind: "done" }),
  ];

  it("returns everything with no filters", () => {
    expect(filterBoardCards(cards, {}, TODAY)).toHaveLength(5);
  });

  it("filters by assignee and label", () => {
    expect(ids(filterBoardCards(cards, { assigneeId: "sam" }, TODAY))).toEqual(["late-sam"]);
    expect(ids(filterBoardCards(cards, { tagId: "red" }, TODAY))).toEqual(["soon-tagged"]);
  });

  it("filters by due date, with 7 days inclusive", () => {
    expect(ids(filterBoardCards(cards, { due: "overdue" }, TODAY))).toEqual(["late-sam"]);
    expect(ids(filterBoardCards(cards, { due: "this_week" }, TODAY))).toEqual(["soon-tagged"]);
    expect(ids(filterBoardCards(cards, { due: "no_date" }, TODAY))).toEqual(["undated"]);
  });

  it("filters by client", () => {
    const withClient = [
      { ...card("zone"), client: { id: "z" } },
      { ...card("none"), client: null },
    ];
    expect(ids(filterBoardCards(withClient, { clientId: "z" }, TODAY))).toEqual(["zone"]);
  });

  it("needs every filter to match", () => {
    expect(filterBoardCards(cards, { assigneeId: "sam", tagId: "red" }, TODAY)).toEqual([]);
  });
});

describe("status and board columns", () => {
  const columns = [
    { name: "Design" },
    { name: "To Do" },
    { name: "in progress" },
    { name: "Done" },
  ];

  it("reads a column's meaning from its name, not for a team's own column", () => {
    expect(columnStatusKind(" To Do ")).toBe("open");
    expect(columnStatusKind("Awaiting approval")).toBe("review");
    expect(columnStatusKind("Design")).toBeNull();
  });
  it("finds the column for a status; closed shares Done", () => {
    expect(columnForStatusKind(columns, "active")?.name).toBe("in progress");
    expect(columnForStatusKind(columns, "closed")?.name).toBe("Done");
    expect(columnForStatusKind(columns, "review")).toBeNull();
  });
});
