import { describe, expect, it } from "vitest";
import {
  MAX_CONTRACT_FILE_BYTES,
  MAX_CONTRACT_FILES_PER_UPLOAD,
  checkContractFiles,
  contractAlertDay,
  contractFileMime,
  contractMessages,
  daysUntil,
  isContractAlertDue,
  isContractEndingSoon,
} from "./documents";
import { officialHolidays } from "./holidays";
import { holidayCalendar } from "./working-days";

const calendar = holidayCalendar(
  [2026, 2027].flatMap((y) =>
    officialHolidays(y, { substitution: true }).map((h) => ({ date: h.date, name: h.nameEn })),
  ),
);

describe("daysUntil", () => {
  it("counts calendar days, including across DST and year ends", () => {
    expect(daysUntil("2026-10-30", "2026-10-30")).toBe(0);
    expect(daysUntil("2026-10-24", "2026-10-26")).toBe(2); // across the fall-back weekend
    expect(daysUntil("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysUntil("2026-11-02", "2026-10-30")).toBe(-3);
  });
});

describe("contractAlertDay (spec §6)", () => {
  it("is the working day before the end date", () => {
    expect(contractAlertDay("2026-11-03", calendar)).toBe("2026-11-02");
  });
  it("skips the weekend", () => {
    expect(contractAlertDay("2026-11-09", calendar)).toBe("2026-11-06");
  });
  it("skips the weekend and 1 January", () => {
    expect(contractAlertDay("2027-01-04", calendar)).toBe("2026-12-31");
  });
  it("still applies when the end date is itself a weekend day", () => {
    expect(contractAlertDay("2026-11-08", calendar)).toBe("2026-11-06");
  });
});

describe("isContractAlertDue", () => {
  // Kosovo is UTC+1 in winter: 07:00Z is 08:00 local.
  it("fires from 08:00 Kosovo time on the alert day", () => {
    expect(isContractAlertDue(new Date("2026-11-02T06:59:00Z"), "2026-11-03", calendar)).toBe(
      false,
    );
    expect(isContractAlertDue(new Date("2026-11-02T07:00:00Z"), "2026-11-03", calendar)).toBe(true);
    expect(isContractAlertDue(new Date("2026-12-31T07:30:00Z"), "2027-01-04", calendar)).toBe(true);
  });
  it("not before the alert day", () => {
    expect(isContractAlertDue(new Date("2026-12-30T12:00:00Z"), "2027-01-04", calendar)).toBe(
      false,
    );
    expect(isContractAlertDue(new Date("2026-11-05T12:00:00Z"), "2026-11-09", calendar)).toBe(
      false,
    );
  });
  it("catches up after downtime, until the contract has ended", () => {
    // Alert day Thu 31.12; the server was down until Sat 02.01 (any hour).
    expect(isContractAlertDue(new Date("2027-01-02T05:00:00Z"), "2027-01-04", calendar)).toBe(true);
    expect(isContractAlertDue(new Date("2027-01-04T09:00:00Z"), "2027-01-04", calendar)).toBe(
      false,
    );
    expect(isContractAlertDue(new Date("2027-01-05T09:00:00Z"), "2027-01-04", calendar)).toBe(
      false,
    );
  });
  it("uses the Kosovo date, not UTC's", () => {
    // 23:30Z on 01.11 is 00:30 on Mon 02.11 in Kosovo — but before 08:00.
    expect(isContractAlertDue(new Date("2026-11-01T23:30:00Z"), "2026-11-03", calendar)).toBe(
      false,
    );
  });
});

describe("contractFileMime", () => {
  it("accepts JPG, PNG, HEIC and PDF", () => {
    expect(contractFileMime("page1.JPG", "image/jpeg")).toBe("image/jpeg");
    expect(contractFileMime("scan.pdf", "application/pdf")).toBe("application/pdf");
    expect(contractFileMime("p.png", "image/png")).toBe("image/png");
    expect(contractFileMime("IMG_0001.HEIC", "")).toBe("image/heic");
  });
  it("refuses other types and mismatches", () => {
    expect(contractFileMime("notes.txt", "text/plain")).toBeNull();
    expect(contractFileMime("evil.pdf", "text/html")).toBeNull();
    expect(contractFileMime("photo.gif", "image/gif")).toBeNull();
    expect(contractFileMime("noext", "image/png")).toBeNull();
  });
});

describe("checkContractFiles", () => {
  const file = (name: string, size = 1000, type = "") => ({ name, size, type });

  it("keeps the allowed files and explains the rest", () => {
    const { accepted, errors } = checkContractFiles(0, [
      file("page-1.jpg"),
      file("notes.docx"),
      file("huge.pdf", MAX_CONTRACT_FILE_BYTES + 1),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["page-1.jpg"]);
    expect(errors).toEqual([
      "notes.docx: contracts can be JPG, PNG, HEIC or PDF",
      "huge.pdf: files can be up to 20 MB",
    ]);
  });

  it("stops at the per-upload limit, counting what's already chosen", () => {
    const { accepted, errors } = checkContractFiles(MAX_CONTRACT_FILES_PER_UPLOAD - 1, [
      file("a.png"),
      file("b.png"),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["a.png"]);
    expect(errors).toEqual(["b.png: up to 30 files at a time"]);
  });

  it("allows exactly 20 MB", () => {
    expect(checkContractFiles(0, [file("a.pdf", MAX_CONTRACT_FILE_BYTES)]).errors).toEqual([]);
  });
});

describe("isContractEndingSoon", () => {
  it("is within 30 days and not past", () => {
    expect(isContractEndingSoon("2026-11-03", "2026-12-03")).toBe(true);
    expect(isContractEndingSoon("2026-11-03", "2026-12-04")).toBe(false);
    expect(isContractEndingSoon("2026-11-03", "2026-11-02")).toBe(false);
    expect(isContractEndingSoon("2026-11-03", null)).toBe(false);
  });
});

describe("contractMessages", () => {
  it("is the spec's sentence", () => {
    expect(contractMessages.ending({ name: "Olsi Sopi", endDate: "2026-11-03" })).toBe(
      "Kontrata e Olsi Sopi përfundon më 03.11.2026. / Olsi Sopi's contract ends on 03.11.2026.",
    );
  });
});
