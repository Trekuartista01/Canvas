import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./brain-system-prompt";

describe("buildSystemPrompt", () => {
  it("returns the base prompt alone for a global conversation", () => {
    const prompt = buildSystemPrompt({ type: "global" });
    expect(prompt).toContain("Canvas's Brain");
    expect(prompt).toContain("clarifying questions");
    expect(prompt).not.toContain("Title:");
  });

  it("includes task title, list name, and extracted description text for a task conversation", () => {
    const prompt = buildSystemPrompt({
      type: "task",
      title: "Design social banner",
      listName: "Campaigns",
      descriptionJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Needs a red barn." }] }],
      },
    });
    expect(prompt).toContain("Title: Design social banner");
    expect(prompt).toContain("List: Campaigns");
    expect(prompt).toContain("Description: Needs a red barn.");
  });

  it("falls back to a placeholder when the task has no description", () => {
    const prompt = buildSystemPrompt({
      type: "task",
      title: "Untitled work",
      listName: "Backlog",
      descriptionJson: null,
    });
    expect(prompt).toContain("Description: (no description)");
  });

  it("includes doc title and linked task ids for a doc conversation", () => {
    const prompt = buildSystemPrompt({
      type: "doc",
      title: "Campaign brief",
      linkedTasks: [{ id: "019f0000-0000-7000-8000-000000000001", title: "Hero banner" }],
    });
    expect(prompt).toContain("Title: Campaign brief");
    expect(prompt).toContain("Hero banner");
    expect(prompt).toContain("019f0000-0000-7000-8000-000000000001");
  });

  it("omits any brand section when no brand is attached", () => {
    const prompt = buildSystemPrompt({ type: "global" }, null);
    expect(prompt).not.toContain("brand kit");
  });

  it("appends the brand kit's name, palette, tone, and guidelines for a global conversation", () => {
    const prompt = buildSystemPrompt(
      { type: "global" },
      {
        name: "Acme Corp",
        palette: ["#FF5733", "#33FF57"],
        tone: "Bold and energetic",
        guidelines: "Never use Comic Sans.",
      },
    );
    expect(prompt).toContain('"Acme Corp"');
    expect(prompt).toContain("#FF5733, #33FF57");
    expect(prompt).toContain("Tone: Bold and energetic");
    expect(prompt).toContain("Guidelines: Never use Comic Sans.");
  });

  it("appends the brand section on top of task context too", () => {
    const prompt = buildSystemPrompt(
      { type: "task", title: "Design banner", listName: "Campaigns", descriptionJson: null },
      { name: "Acme Corp", palette: [], tone: null, guidelines: null },
    );
    expect(prompt).toContain("Title: Design banner");
    expect(prompt).toContain('"Acme Corp"');
  });

  it("omits palette/tone/guidelines lines that are empty or null", () => {
    const prompt = buildSystemPrompt(
      { type: "global" },
      { name: "Bare Kit", palette: [], tone: null, guidelines: null },
    );
    expect(prompt).toContain('"Bare Kit"');
    expect(prompt).not.toContain("Palette:");
    expect(prompt).not.toContain("Tone:");
    expect(prompt).not.toContain("Guidelines:");
  });
});
