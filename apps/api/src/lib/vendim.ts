import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatDmy, type ContractType } from "@canvas/shared";
import Docxtemplater from "docxtemplater";
import { PDFDocument } from "pdf-lib";
import PizZip from "pizzip";

/**
 * P8.5 Vendim (docs/hr-ops-spec.md §4): the company's own annual-leave
 * decision, filled into templates/vendim-pushim-vjetor-template.docx as-is
 * (docxtemplater, `{tag}` delimiters) and converted to PDF by LibreOffice so
 * the Word and PDF versions are always the same document. Never redesigned
 * or retyped here — HR edits the template file if the wording changes.
 */

export const VENDIM_TEMPLATE_FILE = "vendim-pushim-vjetor-template.docx";

/** Every tag in the template. All must be filled, or no Vendim is made. */
export interface VendimData {
  data_vendimit: string;
  emri_mbiemri: string;
  lloji_kontrates: string;
  data_kontrates: string;
  pozita: string;
  viti: string;
  data_fillimit: string;
  data_mbarimit: string;
  ditet_pune: string;
  data_kthimit: string;
}

const CONTRACT_TYPE_SQ: Record<ContractType, string> = {
  fixed_term: "për kohë të caktuar",
  open_ended: "për kohë të pacaktuar",
};

/** What's missing, in words HR can act on (which People field to fill in). */
export class VendimDataError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `The Vendim can't be made — missing: ${missing.join(", ")}. Fix the People record, then regenerate.`,
    );
    this.name = "VendimDataError";
  }
}

export function buildVendimData(input: {
  /** Approval date, "YYYY-MM-DD" in Kosovo time. */
  decidedOn: string;
  fullName: string | null;
  contractType: ContractType | null;
  contractStart: string | null;
  position: string | null;
  startDate: string;
  endDate: string;
  /** The stored value (P8.2 calculator at request time) — never recounted. */
  workingDays: number;
  byYear: Record<string, number>;
  /** nextWorkingDay(endDate). */
  returnDate: string;
}): VendimData {
  const missing: string[] = [];
  if (!input.fullName?.trim()) missing.push("full name");
  if (!input.contractType) missing.push("contract type (People → Confidential)");
  if (!input.contractStart) missing.push("contract start date (People → Confidential)");
  if (!input.position?.trim()) missing.push("position (People → Profile)");
  if (!(input.workingDays > 0)) missing.push("working days");
  if (missing.length > 0) throw new VendimDataError(missing);

  const years = Object.keys(input.byYear).filter((y) => (input.byYear[y] ?? 0) > 0);
  const viti = (years.length > 0 ? years.sort() : [input.startDate.slice(0, 4)]).join("/");
  return {
    data_vendimit: formatDmy(input.decidedOn),
    emri_mbiemri: input.fullName!.trim(),
    lloji_kontrates: CONTRACT_TYPE_SQ[input.contractType!],
    data_kontrates: formatDmy(input.contractStart!),
    pozita: input.position!.trim(),
    viti,
    data_fillimit: formatDmy(input.startDate),
    data_mbarimit: formatDmy(input.endDate),
    ditet_pune: Number.isInteger(input.workingDays)
      ? String(input.workingDays)
      : String(input.workingDays).replace(".", ","),
    data_kthimit: formatDmy(input.returnDate),
  };
}

/** The template: VENDIM_TEMPLATE_PATH, else templates/ found from the repo root. */
export function findVendimTemplate(): string {
  const override = process.env.VENDIM_TEMPLATE_PATH;
  if (override) return override;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "templates", VENDIM_TEMPLATE_FILE);
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`Vendim template not found (templates/${VENDIM_TEMPLATE_FILE})`);
}

/** Fills the template. Throws if the template has a tag we don't fill. */
export function renderVendimDocx(template: Buffer, data: VendimData): Buffer {
  const doc = new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter(part) {
      throw new Error(`Vendim template tag {${part.value}} has no value`);
    },
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** The document's visible text, for tests and checks. */
export function docxText(docx: Buffer): string {
  const xml = new PizZip(docx).file("word/document.xml")?.asText() ?? "";
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const run = promisify(execFile);
const SOFFICE_TIMEOUT_MS = 60_000;

export class PdfConversionUnavailable extends Error {
  constructor(detail: string) {
    super(
      `PDF conversion needs LibreOffice on the server (soffice). ${detail} The Word file was still made.`,
    );
    this.name = "PdfConversionUnavailable";
  }
}

/**
 * DOCX → PDF with LibreOffice headless, in a throwaway directory (its own
 * user profile too, so two conversions never fight over one). SOFFICE_PATH
 * overrides the binary.
 */
export async function convertToPdf(docx: Buffer): Promise<Buffer> {
  const binary = process.env.SOFFICE_PATH || "soffice";
  const dir = await mkdtemp(path.join(tmpdir(), "vendim-"));
  try {
    const input = path.join(dir, "vendim.docx");
    await writeFile(input, docx);
    try {
      await run(
        binary,
        [
          `-env:UserInstallation=file://${dir.replace(/\\/g, "/")}/profile`,
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          input,
        ],
        { timeout: SOFFICE_TIMEOUT_MS },
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new PdfConversionUnavailable(`"${binary}" wasn't found.`);
      throw err;
    }
    return await readFile(path.join(dir, "vendim.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  return (await PDFDocument.load(pdf)).getPageCount();
}
