import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildLeaveDocumentPdf, type LeaveDocumentData } from "./leave-pdf";

const data: LeaveDocumentData = {
  workspaceName: "Trekuartista",
  employeeName: "Arbërë Çeku",
  jobTitle: "Sales associate",
  type: "vacation",
  startDate: "2027-03-01",
  endDate: "2027-03-05",
  workingDays: 5,
  reason: "Family trip",
  approverName: "Mira Manager",
  decidedAt: new Date("2027-02-10T09:30:00Z"),
  recordedByHr: false,
  requestId: "01a18c22-c267-7491-a8f1-2b71125d0047",
  generatedAt: new Date("2027-02-11T10:00:00Z"),
};

describe("buildLeaveDocumentPdf", () => {
  it("renders a one-page PDF", async () => {
    const bytes = await buildLeaveDocumentPdf(data);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Leave confirmation — Arbërë Çeku");
  });

  it("doesn't fail on characters the standard font can't draw", async () => {
    await expect(
      buildLeaveDocumentPdf({ ...data, employeeName: "Иван 🎉", reason: null, jobTitle: null }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
