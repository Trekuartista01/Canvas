/**
 * M7.9 step 1: describe the old Seri MongoDB collections well enough to
 * write SERI_MAPPING.md — which fields exist, their types, how often they're
 * set, what they reference — without copying anyone's personal data out.
 * Pure; the dump/Mongo readers feed it plain documents.
 */

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "objectId"
  | "array"
  | "object"
  | "null"
  | "binary"
  | "other";

export interface FieldStat {
  path: string;
  types: Partial<Record<FieldType, number>>;
  /** Documents that have this field at all (arrays: elements). */
  present: number;
  /** Up to 5 example values, already redacted/truncated. */
  examples: string[];
  /** For short strings with few distinct values: all of them (likely an enum — status, role…). */
  enumValues: string[] | null;
  looksLikeUrl: boolean;
  redacted: boolean;
}

export interface CollectionSummary {
  name: string;
  documents: number;
  sampled: number;
  fields: FieldStat[];
}

// Never show values of these, however harmless they look.
const SENSITIVE =
  /pass|hash|salt|token|secret|otp|iban|account|bank|salary|wage|pay|personal|id_?card|idnumber|nid|ssn|phone|mobile|tel|address|birth|dob|email|e_?mail|name|surname|emergency|note|comment|reason|body|text|content|description|ip$/i;
// …except where the value is a fixed vocabulary we need to map (status, role, type…).
const VOCABULARY =
  /status|state|role|type|kind|category|level|priority|gender|department|position/i;
const MAX_ENUM = 12;
const MAX_ENUM_LENGTH = 40;

function typeOf(value: unknown): FieldType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (typeof value === "string") return "string";
  if (typeof value === "number" || typeof value === "bigint") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") {
    const bsontype = (value as { _bsontype?: string })._bsontype;
    if (bsontype === "ObjectId" || bsontype === "ObjectID") return "objectId";
    if (bsontype === "Binary") return "binary";
    if (
      bsontype === "Decimal128" ||
      bsontype === "Long" ||
      bsontype === "Int32" ||
      bsontype === "Double"
    ) {
      return "number";
    }
    if (bsontype) return "other";
    return "object";
  }
  return "other";
}

function display(value: unknown, type: FieldType): string {
  if (type === "date") return (value as Date).toISOString();
  if (type === "objectId") return `ObjectId(${String(value)})`;
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Whether a field path's values may be shown. */
export function isSensitivePath(path: string) {
  const leaf = path.split(".").pop()!.replace("[]", "");
  return SENSITIVE.test(leaf) && !VOCABULARY.test(leaf);
}

export function summarizeCollection(
  name: string,
  docs: unknown[],
  totalDocuments = docs.length,
): CollectionSummary {
  const stats = new Map<string, FieldStat & { distinct: Set<string>; distinctOverflow: boolean }>();

  const visit = (path: string, value: unknown) => {
    const type = typeOf(value);
    let stat = stats.get(path);
    if (!stat) {
      stat = {
        path,
        types: {},
        present: 0,
        examples: [],
        enumValues: null,
        looksLikeUrl: false,
        redacted: isSensitivePath(path),
        distinct: new Set(),
        distinctOverflow: false,
      };
      stats.set(path, stat);
    }
    stat.present++;
    stat.types[type] = (stat.types[type] ?? 0) + 1;

    if (type === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>))
        visit(`${path}.${key}`, child);
      return;
    }
    if (type === "array") {
      for (const item of value as unknown[]) visit(`${path}[]`, item);
      return;
    }
    if (type === "string") {
      const s = value as string;
      if (/^https?:\/\//i.test(s)) stat.looksLikeUrl = true;
      if (!stat.distinctOverflow) {
        if (s.length > MAX_ENUM_LENGTH) stat.distinctOverflow = true;
        else {
          stat.distinct.add(s);
          if (stat.distinct.size > MAX_ENUM) stat.distinctOverflow = true;
        }
      }
    } else if (type !== "null") {
      stat.distinctOverflow = stat.distinctOverflow || type !== "boolean";
    }
    if (type !== "null" && stat.examples.length < 5) {
      const shown = stat.redacted ? "<redacted>" : display(value, type);
      if (!stat.examples.includes(shown)) stat.examples.push(shown);
    }
  };

  for (const doc of docs) {
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      for (const [key, value] of Object.entries(doc as Record<string, unknown>)) visit(key, value);
    }
  }

  const fields = [...stats.values()]
    .map(({ distinct, distinctOverflow, ...stat }) => ({
      ...stat,
      // Enum values only when they're a small fixed vocabulary, never for sensitive fields.
      enumValues:
        !stat.redacted && !distinctOverflow && distinct.size > 0 && distinct.size <= MAX_ENUM
          ? [...distinct].sort()
          : null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { name, documents: totalDocuments, sampled: docs.length, fields };
}

export function renderInspectionMarkdown(source: string, collections: CollectionSummary[]): string {
  const lines = [
    "# Seri inspection",
    "",
    `Source: ${source} — generated ${new Date().toISOString()}.`,
    "Values of personal/sensitive-looking fields are redacted; this file is for writing SERI_MAPPING.md, not for keeping.",
    "",
    "| Collection | Documents |",
    "| --- | ---: |",
    ...collections.map((c) => `| ${c.name} | ${c.documents} |`),
    "",
  ];
  for (const c of collections) {
    lines.push(
      `## ${c.name} (${c.documents} documents${c.sampled < c.documents ? `, ${c.sampled} sampled` : ""})`,
      "",
    );
    lines.push("| Field | Types | Present | Examples / values |", "| --- | --- | ---: | --- |");
    for (const f of c.fields) {
      const types = Object.entries(f.types)
        .map(([t, n]) => (Object.keys(f.types).length > 1 ? `${t}×${n}` : t))
        .join(", ");
      const pct = c.sampled ? `${Math.round((f.present / c.sampled) * 100)}%` : "—";
      const values = f.enumValues
        ? `enum: ${f.enumValues.map((v) => `\`${v}\``).join(", ")}`
        : f.examples.map((e) => `\`${e.replace(/\|/g, "\\|")}\``).join(", ");
      lines.push(
        `| \`${f.path}\` | ${types}${f.looksLikeUrl ? " (URL)" : ""} | ${pct} | ${values} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
