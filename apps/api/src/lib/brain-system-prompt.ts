import { extractPlainText } from "./plain-text";

const BASE_PROMPT = [
  "You are Canvas's Brain — a helpful assistant embedded in this workspace's task management tool.",
  "You can use tools to generate_image, edit_image, attach_to_task, summarize_thread, and critique_image when they help answer the user.",
  "Prefer calling tools rather than claiming you created or attached something without doing so.",
  "Before generating or editing an image, ask 2–4 short clarifying questions when the request is vague (audience/use, must-have visuals, style, what to avoid).",
  "Wait for the user's answers before calling generate_image or edit_image, unless they already gave enough concrete detail or explicitly say to proceed.",
  "When the user attaches reference images, treat them as visual guidance for generate/edit/critique. Non-image attachments are named in the message text as context only.",
].join(" ");

export type BrandContext = {
  name: string;
  palette: string[];
  tone: string | null;
  guidelines: string | null;
};

function brandLines(brand: BrandContext | null | undefined): string[] {
  if (!brand) return [];
  const lines = [
    "",
    `A brand kit ("${brand.name}") is attached to this conversation — follow it for any image generation/editing and any brand-related question:`,
  ];
  if (brand.palette.length > 0) lines.push(`Palette: ${brand.palette.join(", ")}`);
  if (brand.tone) lines.push(`Tone: ${brand.tone}`);
  if (brand.guidelines) lines.push(`Guidelines: ${brand.guidelines}`);
  return lines;
}

// Pure — takes already-fetched rows rather than doing its own DB I/O, so
// it's unit-testable without a database. ARCHITECTURE.md §3.3: "Context
// injection: task title/description, list name, brand settings... prepended
// as system context." `brand` is an explicit choice made in the Brain panel
// (see brain.setBrandKit), applied on top of any context type below.
export function buildSystemPrompt(
  context:
    | { type: "global" }
    | { type: "task"; title: string; listName: string; descriptionJson: unknown }
    | { type: "doc"; title: string; linkedTasks: { id: string; title: string }[] },
  brand?: BrandContext | null,
): string {
  if (context.type === "global") return [BASE_PROMPT, ...brandLines(brand)].join("\n");

  if (context.type === "doc") {
    const linked =
      context.linkedTasks.length === 0
        ? "(none)"
        : context.linkedTasks.map((t) => `- ${t.title} (${t.id})`).join("\n");
    return [
      BASE_PROMPT,
      "",
      "You are currently focused on this doc:",
      `Title: ${context.title}`,
      "Linked tasks (use these ids with attach_to_task when relevant):",
      linked,
      "When you generate_image in this doc context, the client inserts the result into the doc automatically.",
      ...brandLines(brand),
    ].join("\n");
  }

  const description = extractPlainText(context.descriptionJson).trim();
  return [
    BASE_PROMPT,
    "",
    "You are currently focused on this task:",
    `Title: ${context.title}`,
    `List: ${context.listName}`,
    `Description: ${description || "(no description)"}`,
    ...brandLines(brand),
  ].join("\n");
}
