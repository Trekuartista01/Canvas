import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { PayrollRow } from "./payroll";
import { buildPayrollPdf, buildPayrollXlsx } from "./payroll-export";

const row = (i: number, over: Partial<PayrollRow> = {}): PayrollRow => ({
  userId: `u${i}`,
  name: `Person ${i}`,
  email: `p${i}@example.com`,
  jobTitle: "Sales associate",
  recordId: `r${i}`,
  netSalaryEur: 650.5,
  bankName: "Banka Kombëtare",
  accountHolder: `Person ${i}`,
  idCardNumber: "1234567890",
  iban: "XK051212012345678906",
  updatedAt: new Date(),
  updatedByName: "Hana HR",
  ...over,
});

describe("buildPayrollXlsx", () => {
  it("writes every row plus a total, with full values", async () => {
    const buffer = await buildPayrollXlsx(
      [row(1), row(2, { netSalaryEur: 1000, iban: null, idCardNumber: null })],
      "Trekuartista",
    );
    const workbook = new ExcelJS.Workbook();
    // justified: exceljs types its own pre-generic Buffer; the bytes are the same.
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("Payroll")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Employee");
    expect(sheet.getRow(2).getCell(5).value).toBe("1234567890");
    expect(sheet.getRow(2).getCell(7).value).toBe("XK05 1212 0123 4567 8906");
    expect(sheet.getRow(3).getCell(7).value).toBe("");
    expect(sheet.getRow(4).getCell(1).value).toBe("Total");
    expect(sheet.getRow(4).getCell(4).value).toBe(1650.5);
  });
});

describe("buildPayrollPdf", () => {
  it("paginates a large table", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i));
    const doc = await PDFDocument.load(await buildPayrollPdf(rows, "Trekuartista", new Date()));
    expect(doc.getPageCount()).toBeGreaterThan(3);
  });

  it("copes with characters the standard font can't draw", async () => {
    await expect(
      buildPayrollPdf([row(1, { name: "Иван 🎉" })], "Ws", new Date()),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
