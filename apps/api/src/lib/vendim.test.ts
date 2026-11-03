import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildVendimData,
  convertToPdf,
  docxText,
  findVendimTemplate,
  pdfPageCount,
  renderVendimDocx,
  VendimDataError,
} from "./vendim";

// docs/hr-ops-spec.md §4: the real Vendim in the reference photo.
const example = {
  decidedOn: "2026-02-20",
  fullName: "Olsi Sopi",
  contractType: "fixed_term" as const,
  contractStart: "2025-03-01",
  position: "Graphic Designer",
  startDate: "2026-02-25",
  endDate: "2026-03-02",
  workingDays: 4,
  byYear: { "2026": 4 },
  returnDate: "2026-03-03",
};

const template = () => readFileSync(findVendimTemplate());

describe("buildVendimData", () => {
  it("maps every tag in Kosovo date format", () => {
    expect(buildVendimData(example)).toEqual({
      data_vendimit: "20.02.2026",
      emri_mbiemri: "Olsi Sopi",
      lloji_kontrates: "për kohë të caktuar",
      data_kontrates: "01.03.2025",
      pozita: "Graphic Designer",
      viti: "2026",
      data_fillimit: "25.02.2026",
      data_mbarimit: "02.03.2026",
      ditet_pune: "4",
      data_kthimit: "03.03.2026",
    });
  });

  it("writes both years for a request across New Year, and the open-ended wording", () => {
    const d = buildVendimData({
      ...example,
      contractType: "open_ended",
      startDate: "2026-12-30",
      endDate: "2027-01-05",
      workingDays: 3,
      byYear: { "2026": 2, "2027": 1 },
    });
    expect(d.viti).toBe("2026/2027");
    expect(d.lloji_kontrates).toBe("për kohë të pacaktuar");
  });

  it("fails loudly, naming every missing People field", () => {
    expect(() =>
      buildVendimData({ ...example, contractStart: null, position: " ", contractType: null }),
    ).toThrow(VendimDataError);
    try {
      buildVendimData({ ...example, contractStart: null });
    } catch (err) {
      expect((err as VendimDataError).missing).toEqual([
        "contract start date (People → Confidential)",
      ]);
    }
  });
});

describe("renderVendimDocx", () => {
  it("fills the real template: (4 ditë pune), back on 03.03.2026, no tag left", () => {
    const text = docxText(renderVendimDocx(template(), buildVendimData(example)));
    expect(text).toContain("(4 ditë pune)");
    expect(text).toContain("03.03.2026");
    expect(text).toContain("me datën 20.02.2026");
    expect(text).toContain("Prishtinë, 20.02.2026");
    expect(text).toContain("për vitin kalendarik 2026");
    expect(text.match(/Olsi Sopi/g)).toHaveLength(2);
    // The fixed text stays as written.
    expect(text).toContain("Arian Ahmeti");
    expect(text).toContain("Punonjësi/ja");
    expect(text).not.toMatch(/\{[a-z_]+\}/);
  });
});

function hasSoffice() {
  try {
    execFileSync(process.env.SOFFICE_PATH || "soffice", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Needs LibreOffice; CI and the server have it, a bare dev machine may not.
describe.skipIf(!hasSoffice())("convertToPdf", () => {
  it("makes a one-page PDF of the filled Vendim", async () => {
    const pdf = await convertToPdf(renderVendimDocx(template(), buildVendimData(example)));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await pdfPageCount(pdf)).toBe(1);
  }, 90_000);
});
