import { ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import { isSensitivePath, renderInspectionMarkdown, summarizeCollection } from "./field-stats";

const docs = [
  {
    _id: new ObjectId(),
    email: "arbena@example.com",
    password: "$2b$10$abcdef",
    role: "manager",
    status: "active",
    profile: { phone: "+383 44 123 456", position: "Sales" },
    createdAt: new Date("2025-01-02T10:00:00Z"),
    photos: [{ url: "https://seri-storage.example.com/a.jpg" }],
    manager: new ObjectId(),
  },
  {
    _id: new ObjectId(),
    email: "besa@example.com",
    password: "$2b$10$ghijk",
    role: "staff",
    status: "inactive",
    profile: { position: "Driver" },
    createdAt: new Date("2025-02-03T10:00:00Z"),
    photos: [],
    manager: null,
  },
];

describe("summarizeCollection", () => {
  const summary = summarizeCollection("users", docs, 120);
  const field = (path: string) => summary.fields.find((f) => f.path === path)!;

  it("lists nested and array paths with types and presence", () => {
    expect(summary).toMatchObject({ name: "users", documents: 120, sampled: 2 });
    expect(field("profile.position").present).toBe(2);
    expect(field("profile.phone").present).toBe(1);
    expect(field("createdAt").types).toEqual({ date: 2 });
    expect(field("manager").types).toEqual({ objectId: 1, null: 1 });
    expect(field("photos[].url").looksLikeUrl).toBe(true);
  });

  it("never shows personal or secret values", () => {
    for (const path of ["email", "password", "profile.phone"]) {
      expect(field(path).redacted).toBe(true);
      expect(field(path).examples.every((e) => e === "<redacted>")).toBe(true);
      expect(field(path).enumValues).toBeNull();
    }
    const md = renderInspectionMarkdown("test", [summary]);
    expect(md).not.toContain("arbena@example.com");
    expect(md).not.toContain("$2b$10");
    expect(md).not.toContain("123 456");
  });

  it("lists the vocabulary of status/role-like fields", () => {
    expect(field("role").enumValues).toEqual(["manager", "staff"]);
    expect(field("status").enumValues).toEqual(["active", "inactive"]);
    expect(field("profile.position").enumValues).toEqual(["Driver", "Sales"]);
  });
});

describe("isSensitivePath", () => {
  it("flags personal fields but keeps fixed vocabularies visible", () => {
    expect(isSensitivePath("iban")).toBe(true);
    expect(isSensitivePath("payroll.netSalary")).toBe(true);
    expect(isSensitivePath("firstName")).toBe(true);
    expect(isSensitivePath("leaveType")).toBe(false);
    expect(isSensitivePath("status")).toBe(false);
    expect(isSensitivePath("dueDate")).toBe(false);
  });
});
