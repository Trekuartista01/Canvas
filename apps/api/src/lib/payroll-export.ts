import { formatIban } from "@canvas/shared";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { PayrollRow } from "./payroll";

// M7.7 whole-table exports. They contain the decrypted ID-card numbers and
// IBANs, so the route that serves them checks payroll:view and writes a
// "payroll.exported" activity row every time.

const COLUMNS = [
  { header: "Employee", key: "name", width: 28 },
  { header: "Email", key: "email", width: 30 },
  { header: "Position", key: "jobTitle", width: 22 },
  { header: "Net salary (EUR)", key: "netSalaryEur", width: 16 },
  { header: "ID card number", key: "idCardNumber", width: 18 },
  { header: "Bank", key: "bankName", width: 22 },
  { header: "IBAN", key: "iban", width: 30 },
  { header: "Account holder", key: "accountHolder", width: 26 },
] as const;

function cell(row: PayrollRow, key: (typeof COLUMNS)[number]["key"]): string | number | null {
  if (key === "iban")
    return row.iban && row.iban !== "[unreadable]" ? formatIban(row.iban) : row.iban;
  return row[key];
}

export async function buildPayrollXlsx(rows: PayrollRow[], workspaceName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Canvas";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Payroll", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(COLUMNS.map((c) => [c.key, cell(row, c.key) ?? ""])));
  }
  sheet.getColumn("netSalaryEur").numFmt = '#,##0.00 "€"';
  // Text, so long ID numbers aren't turned into scientific notation.
  sheet.getColumn("idCardNumber").numFmt = "@";
  const total = rows.reduce((sum, r) => sum + (r.netSalaryEur ?? 0), 0);
  const totalRow = sheet.addRow({ name: "Total", netSalaryEur: total });
  totalRow.font = { bold: true };
  workbook.title = `Payroll — ${workspaceName}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

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

function fit(font: PDFFont, text: string, size: number, width: number) {
  let value = encodable(font, text);
  while (value.length > 1 && font.widthOfTextAtSize(value, size) > width) {
    value = `${value.slice(0, -2)}…`;
  }
  return value;
}

/** Landscape A4, a header row repeated on every page, a total at the end. */
export async function buildPayrollPdf(
  rows: PayrollRow[],
  workspaceName: string,
  generatedAt: Date,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payroll — ${workspaceName}`);
  pdf.setCreator("Canvas");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [841.89, 595.28];
  const margin = 32;
  const size = 8;
  const rowHeight = 15;
  const widths = [120, 0, 90, 70, 80, 95, 135, 110];
  widths[1] = W - margin * 2 - widths.reduce((a, b) => a + b, 0);
  const pdfColumns = COLUMNS.map((c, i) => ({ ...c, width: widths[i]! }));
  const stamp = generatedAt.toLocaleString("en-GB", { timeZone: "Europe/Belgrade" });
  const money = (n: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let page = pdf.addPage([W, H]);
  let y = H - margin;
  let pageNo = 1;

  const header = () => {
    page.drawText(encodable(bold, `Payroll — ${workspaceName}`), {
      x: margin,
      y,
      size: 13,
      font: bold,
    });
    page.drawText(encodable(regular, `Confidential · generated ${stamp} · page ${pageNo}`), {
      x: margin,
      y: y - 14,
      size: 8,
      font: regular,
      color: rgb(0.4, 0.4, 0.45),
    });
    y -= 36;
    let x = margin;
    for (const c of pdfColumns) {
      page.drawText(fit(bold, c.header, size, c.width - 4), { x, y, size, font: bold });
      x += c.width;
    }
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.5 });
    y -= rowHeight - 4;
  };

  const line = (values: string[], font: PDFFont) => {
    if (y < margin + rowHeight) {
      page = pdf.addPage([W, H]);
      pageNo++;
      y = H - margin;
      header();
    }
    let x = margin;
    values.forEach((value, i) => {
      page.drawText(fit(font, value, size, pdfColumns[i]!.width - 4), { x, y, size, font });
      x += pdfColumns[i]!.width;
    });
    y -= rowHeight;
  };

  header();
  for (const row of rows) {
    line(
      pdfColumns.map((c) => {
        const v = cell(row, c.key);
        return c.key === "netSalaryEur"
          ? typeof v === "number"
            ? money(v)
            : ""
          : v === null
            ? ""
            : String(v);
      }),
      regular,
    );
  }
  const total = rows.reduce((sum, r) => sum + (r.netSalaryEur ?? 0), 0);
  line(
    pdfColumns.map((c) =>
      c.key === "name" ? "Total" : c.key === "netSalaryEur" ? money(total) : "",
    ),
    bold,
  );
  return pdf.save();
}
