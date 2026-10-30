import { LEAVE_TYPE_LABELS, type LeaveType } from "@canvas/shared";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface LeaveDocumentData {
  workspaceName: string;
  employeeName: string;
  jobTitle: string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string | null;
  approverName: string | null;
  decidedAt: Date | null;
  recordedByHr: boolean;
  requestId: string;
  generatedAt: Date;
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTimestamp(at: Date) {
  return at.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  });
}

/**
 * The standard PDF fonts only cover WinAnsi (Latin-1-ish — Albanian ë/ç are
 * fine); anything else (emoji, Cyrillic) would make pdf-lib throw, so it's
 * replaced rather than failing the whole document.
 */
function encodable(font: PDFFont, text: string) {
  return [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");
}

/** M7.5 leave confirmation — one A4 page. */
export async function buildLeaveDocumentPdf(data: LeaveDocumentData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Leave confirmation — ${data.employeeName}`);
  pdf.setCreator("Canvas");
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const muted = rgb(0.4, 0.4, 0.45);
  const margin = 56;
  let y = 841.89 - margin;

  const text = (
    value: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) => {
    const font = opts.font ?? regular;
    page.drawText(encodable(font, value), {
      x: opts.x ?? margin,
      y,
      size: opts.size ?? 11,
      font,
      color: opts.color ?? rgb(0.1, 0.1, 0.12),
      maxWidth: 595.28 - margin * 2,
    });
  };

  text(data.workspaceName, { font: bold, size: 12, color: muted });
  y -= 34;
  text("Leave confirmation", { font: bold, size: 22 });
  y -= 36;

  const rows: [string, string][] = [
    ["Employee", data.employeeName],
    ...(data.jobTitle ? ([["Position", data.jobTitle]] as [string, string][]) : []),
    ["Type of leave", LEAVE_TYPE_LABELS[data.type]],
    ["From", formatDate(data.startDate)],
    ["To", formatDate(data.endDate)],
    ["Working days", String(data.workingDays)],
    ...(data.reason ? ([["Reason", data.reason]] as [string, string][]) : []),
    ["Status", data.recordedByHr ? "Approved (recorded by HR)" : "Approved"],
    ["Approved by", data.approverName ?? "—"],
    ["Approved on", data.decidedAt ? formatTimestamp(data.decidedAt) : "—"],
  ];
  for (const [label, value] of rows) {
    text(label, { font: bold, size: 10, color: muted });
    text(value.length > 300 ? `${value.slice(0, 300)}…` : value, { x: margin + 130 });
    y -= 24;
  }

  y -= 40;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + 200, y },
    thickness: 0.75,
    color: muted,
  });
  y -= 14;
  text("Signature", { size: 9, color: muted });

  y = margin;
  text(`Generated ${formatTimestamp(data.generatedAt)} · reference ${data.requestId}`, {
    size: 8,
    color: muted,
  });

  return pdf.save();
}
