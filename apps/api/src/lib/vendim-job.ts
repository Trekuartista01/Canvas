import { readFile } from "node:fs/promises";
import { db, schema } from "@canvas/db";
import { todayReportDate } from "@canvas/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { findMembership } from "./membership";
import { publish } from "./realtime";
import { deleteObject, putObject } from "./storage";
import {
  buildVendimData,
  convertToPdf,
  findVendimTemplate,
  PdfConversionUnavailable,
  pdfPageCount,
  renderVendimDocx,
  VendimDataError,
} from "./vendim";
import { nextWorkingDay } from "./working-days";

/** Private storage prefix for generated Vendims (never served through /uploads). */
export const VENDIM_PREFIX = "hr/vendim/";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Only approved annual leave gets a Vendim (spec §3/§4). */
export function needsVendim(request: { type: string; status: string }) {
  return request.type === "vacation" && request.status === "approved";
}

/**
 * The BullMQ job body (worker.ts): makes the Word + PDF Vendim for one
 * approved annual-leave request and stores both privately. A missing People
 * field fails loudly — no files are saved and the reason is shown to HR on
 * the request; HR fixes the record and presses Regenerate. Without
 * LibreOffice the Word file is still saved and the PDF error is shown.
 */
export async function runVendim(leaveRequestId: string) {
  const request = await db.query.leaveRequests.findFirst({
    where: eq(schema.leaveRequests.id, leaveRequestId),
  });
  if (!request || !needsVendim(request)) return;
  const { workspaceId, userId } = request;

  const fail = async (message: string) => {
    await db
      .update(schema.leaveRequests)
      .set({ vendimError: message, updatedAt: new Date() })
      .where(eq(schema.leaveRequests.id, request.id));
    await publish(workspaceId, { entity: "leave", id: request.id, workspaceId, kind: "updated" });
  };

  const [user, membership, contract] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    findMembership(workspaceId, userId),
    db.query.employmentContracts.findFirst({
      where: and(
        eq(schema.employmentContracts.workspaceId, workspaceId),
        eq(schema.employmentContracts.userId, userId),
        eq(schema.employmentContracts.kind, "contract"),
        isNull(schema.employmentContracts.deletedAt),
      ),
      orderBy: desc(schema.employmentContracts.startDate),
    }),
  ]);
  const profile = membership
    ? await db.query.employeeProfiles.findFirst({
        where: eq(schema.employeeProfiles.membershipId, membership.id),
      })
    : undefined;

  let docx: Buffer;
  try {
    const data = buildVendimData({
      decidedOn: todayReportDate(request.decidedAt ?? new Date()),
      fullName: user?.name ?? null,
      contractType: profile?.contractType ?? null,
      // The People record's contract start; else the newest uploaded contract.
      contractStart: profile?.contractStart ?? contract?.startDate ?? null,
      position: profile?.jobTitle ?? null,
      startDate: request.startDate,
      endDate: request.endDate,
      workingDays: request.workingDays,
      byYear: request.byYear,
      returnDate: await nextWorkingDay(workspaceId, request.endDate),
    });
    docx = renderVendimDocx(await readFile(findVendimTemplate()), data);
  } catch (err) {
    if (err instanceof VendimDataError) return fail(err.message);
    throw err;
  }

  let pdf: Buffer | null = null;
  let pdfProblem: string | null = null;
  try {
    pdf = await convertToPdf(docx);
    const pages = await pdfPageCount(pdf);
    if (pages !== 1) {
      pdfProblem = `The PDF came out ${pages} pages instead of 1 — the server is probably missing the Garamond font.`;
    }
  } catch (err) {
    if (!(err instanceof PdfConversionUnavailable))
      console.error("[vendim] PDF conversion failed:", err);
    pdfProblem = err instanceof PdfConversionUnavailable ? err.message : "PDF conversion failed.";
  }

  const base = `${VENDIM_PREFIX}${workspaceId}/${uuidv7()}`;
  const docxKey = `${base}.docx`;
  const pdfKey = pdf ? `${base}.pdf` : null;
  await putObject(docxKey, docx, DOCX_MIME);
  if (pdf && pdfKey) await putObject(pdfKey, pdf, "application/pdf");

  await db
    .update(schema.leaveRequests)
    .set({
      vendimDocxKey: docxKey,
      vendimPdfKey: pdfKey,
      vendimGeneratedAt: new Date(),
      vendimError: pdfProblem,
      updatedAt: new Date(),
    })
    .where(eq(schema.leaveRequests.id, request.id));

  // Regenerated: the old files go.
  for (const old of [request.vendimDocxKey, request.vendimPdfKey]) {
    if (old && old !== docxKey && old !== pdfKey) {
      await deleteObject(old).catch((err: unknown) =>
        console.error(`[vendim] could not delete old file ${old}:`, err),
      );
    }
  }
  await publish(workspaceId, { entity: "leave", id: request.id, workspaceId, kind: "updated" });
}
