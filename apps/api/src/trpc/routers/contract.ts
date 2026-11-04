import { db, schema } from "@canvas/db";
import {
  MAX_CONTRACT_FILE_BYTES,
  addContractFilesSchema,
  confirmDocumentSchema,
  contractFileIdSchema,
  contractFileMime,
  contractFileUrlSchema,
  contractIdSchema,
  contractsForPersonSchema,
  createContractSchema,
  daysUntil,
  presignContractFileSchema,
  replaceContractFileSchema,
  todayReportDate,
  updateContractSchema,
  workspaceScopedSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { logActivity } from "../../lib/activity";
import { writeAudit } from "../../lib/audit";
import { getMembershipRole } from "../../lib/membership";
import { assertCanPeople, requireActiveMember } from "../../lib/permissions";
import {
  PRIVATE_PREFIXES,
  SIGNED_URL_TTL_SECONDS,
  confirmPrivateUpload,
  presignPrivateUpload,
  requirePrivateAttachment,
  signedDownloadUrl,
} from "../../lib/private-upload";
import { getPresignedUrl } from "../../lib/storage";
import { protectedProcedure, router } from "../trpc";

const contractColumns = {
  id: schema.employmentContracts.id,
  workspaceId: schema.employmentContracts.workspaceId,
  userId: schema.employmentContracts.userId,
  userName: schema.users.name,
  kind: schema.employmentContracts.kind,
  parentContractId: schema.employmentContracts.parentContractId,
  title: schema.employmentContracts.title,
  contractType: schema.employmentContracts.contractType,
  startDate: schema.employmentContracts.startDate,
  expiryDate: schema.employmentContracts.expiryDate,
  endAlertSentAt: schema.employmentContracts.endAlertSentAt,
  uploadedBy: schema.employmentContracts.uploadedBy,
  createdAt: schema.employmentContracts.createdAt,
  updatedAt: schema.employmentContracts.updatedAt,
};

type ContractRow = Awaited<ReturnType<typeof selectContracts>>[number];

function selectContracts(where: ReturnType<typeof and>) {
  return db
    .select(contractColumns)
    .from(schema.employmentContracts)
    .innerJoin(schema.users, eq(schema.users.id, schema.employmentContracts.userId))
    .where(and(where, isNull(schema.employmentContracts.deletedAt)))
    .orderBy(asc(schema.users.name), desc(schema.employmentContracts.startDate));
}

/** The live files of these contracts, in order — no storage keys leave the server. */
async function selectFiles(contractIds: string[]) {
  if (contractIds.length === 0) return [];
  return db
    .select({
      id: schema.contractFiles.id,
      contractId: schema.contractFiles.contractId,
      orderKey: schema.contractFiles.orderKey,
      fileName: schema.attachments.fileName,
      mime: schema.attachments.mime,
      sizeBytes: schema.attachments.sizeBytes,
      thumbKey: schema.attachments.thumbKey,
      blurhash: schema.attachments.blurhash,
      createdAt: schema.contractFiles.createdAt,
      uploaderName: schema.users.name,
    })
    .from(schema.contractFiles)
    .innerJoin(schema.attachments, eq(schema.attachments.id, schema.contractFiles.attachmentId))
    .leftJoin(schema.users, eq(schema.users.id, schema.contractFiles.uploadedBy))
    .where(
      and(
        inArray(schema.contractFiles.contractId, contractIds),
        isNull(schema.contractFiles.deletedAt),
      ),
    )
    .orderBy(asc(schema.contractFiles.contractId), asc(schema.contractFiles.orderKey));
}

/**
 * Contracts with their files. `withThumbs` signs a 5-minute link for each
 * image thumbnail (HR's per-person view only — never the 5k-row list).
 */
async function withFiles(rows: ContractRow[], opts: { withThumbs: boolean }) {
  const today = todayReportDate(new Date());
  const files = await selectFiles(rows.map((r) => r.id));
  const byContract = new Map<string, Awaited<ReturnType<typeof publicFile>>[]>();
  for (const f of files) {
    const list = byContract.get(f.contractId) ?? [];
    list.push(await publicFile(f, opts.withThumbs));
    byContract.set(f.contractId, list);
  }
  return rows.map((r) => ({
    ...r,
    daysLeft: r.expiryDate ? daysUntil(today, r.expiryDate) : null,
    files: byContract.get(r.id) ?? [],
  }));
}

async function publicFile(f: Awaited<ReturnType<typeof selectFiles>>[number], withThumb: boolean) {
  const { thumbKey, orderKey: _orderKey, ...rest } = f;
  return {
    ...rest,
    thumbUrl:
      withThumb && thumbKey ? await getPresignedUrl(thumbKey, SIGNED_URL_TTL_SECONDS) : null,
  };
}

async function requireContract(contractId: string) {
  const contract = await db.query.employmentContracts.findFirst({
    where: and(
      eq(schema.employmentContracts.id, contractId),
      isNull(schema.employmentContracts.deletedAt),
    ),
  });
  if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
  return contract;
}

async function requireContractFile(fileId: string) {
  const file = await db.query.contractFiles.findFirst({
    where: and(eq(schema.contractFiles.id, fileId), isNull(schema.contractFiles.deletedAt)),
  });
  if (!file) throw new TRPCError({ code: "NOT_FOUND" });
  return { file, contract: await requireContract(file.contractId) };
}

/** Uploaded through this router (hr/contracts/…), in this workspace, and not filed yet. */
async function assertUnusedContractFiles(workspaceId: string, attachmentIds: string[]) {
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The same file was sent twice" });
  }
  for (const id of attachmentIds) {
    await requirePrivateAttachment(PRIVATE_PREFIXES.contract, workspaceId, id);
  }
  const used = await db.query.contractFiles.findFirst({
    where: inArray(schema.contractFiles.attachmentId, attachmentIds),
  });
  if (used) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is already filed" });
}

function assertDates(startDate: string, expiryDate: string | null | undefined) {
  if (expiryDate && expiryDate < startDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The end date is before the start" });
  }
}

/** Appends files after the contract's last one, in the order given. */
async function appendFiles(contractId: string, attachmentIds: string[], uploadedBy: string) {
  const last = await db.query.contractFiles.findFirst({
    where: eq(schema.contractFiles.contractId, contractId),
    orderBy: desc(schema.contractFiles.orderKey),
  });
  const keys = generateNKeysBetween(last?.orderKey ?? null, null, attachmentIds.length);
  return db
    .insert(schema.contractFiles)
    .values(
      attachmentIds.map((attachmentId, i) => ({
        contractId,
        attachmentId,
        orderKey: keys[i] ?? generateKeyBetween(last?.orderKey ?? null, null),
        uploadedBy,
      })),
    )
    .returning({ id: schema.contractFiles.id });
}

/** P8.6: a new file, or a new end date, re-arms the end-date alert (spec §6). */
async function touchContract(contractId: string, resetAlert: boolean) {
  await db
    .update(schema.employmentContracts)
    .set({ updatedAt: new Date(), ...(resetAlert ? { endAlertSentAt: null } : {}) })
    .where(eq(schema.employmentContracts.id, contractId));
}

export const contractRouter = router({
  // "My contract": the caller's own documents only (file names, no links).
  mine: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const rows = await selectContracts(
      and(
        eq(schema.employmentContracts.workspaceId, input.workspaceId),
        eq(schema.employmentContracts.userId, ctx.user.id),
      ),
    );
    return withFiles(rows, { withThumbs: false });
  }),

  // HR: every contract in the workspace (the Contracts page's person list).
  list: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "contract:manage");
    const rows = await selectContracts(
      eq(schema.employmentContracts.workspaceId, input.workspaceId),
    );
    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      action: "contract.list_viewed",
      entity: "contract",
      ip: ctx.ip,
    });
    return withFiles(rows, { withThumbs: false });
  }),

  // HR: one person's contracts, with signed thumbnails.
  forPerson: protectedProcedure.input(contractsForPersonSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "contract:manage", {
      targetUserId: input.userId,
    });
    const rows = await selectContracts(
      and(
        eq(schema.employmentContracts.workspaceId, input.workspaceId),
        eq(schema.employmentContracts.userId, input.userId),
      ),
    );
    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      action: "contract.viewed",
      entity: "person",
      entityId: input.userId,
      ip: ctx.ip,
    });
    return withFiles(rows, { withThumbs: true });
  }),

  presignUpload: protectedProcedure
    .input(presignContractFileSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "contract:manage");
      const mime = contractFileMime(input.fileName, input.mime)!;
      const presigned = await presignPrivateUpload(PRIVATE_PREFIXES.contract, { ...input, mime });
      return { ...presigned, mime };
    }),

  confirmUpload: protectedProcedure
    .input(confirmDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "contract:manage");
      if (contractFileMime(input.fileName, input.mime) !== input.mime) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Contracts can be JPG, PNG, HEIC or PDF",
        });
      }
      return confirmPrivateUpload(PRIVATE_PREFIXES.contract, ctx.user.id, input, {
        maxBytes: MAX_CONTRACT_FILE_BYTES,
        thumbnail: true,
      });
    }),

  create: protectedProcedure.input(createContractSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "contract:manage", {
      targetUserId: input.userId,
    });
    if (!(await getMembershipRole(input.workspaceId, input.userId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Not an active member" });
    }
    assertDates(input.startDate, input.expiryDate);
    let parentContractId: string | null = null;
    if (input.kind === "contract") {
      if (input.parentContractId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A contract can't have a parent" });
      }
    } else {
      if (!input.parentContractId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose the contract this belongs to",
        });
      }
      const parent = await requireContract(input.parentContractId);
      if (parent.userId !== input.userId || parent.kind !== "contract") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "It has to belong to one of this person's contracts",
        });
      }
      parentContractId = parent.id;
    }
    await assertUnusedContractFiles(input.workspaceId, input.attachmentIds);

    const [contract] = await db
      .insert(schema.employmentContracts)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        kind: input.kind,
        parentContractId,
        title: input.title,
        contractType: input.contractType ?? null,
        startDate: input.startDate,
        expiryDate: input.expiryDate ?? null,
        uploadedBy: ctx.user.id,
      })
      .returning();
    if (!contract) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await appendFiles(contract.id, input.attachmentIds, ctx.user.id);

    await logActivity(input.workspaceId, ctx.user.id, "contract", contract.id, "contract.created", {
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      files: input.attachmentIds.length,
    });
    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      action: "contract.created",
      entity: "contract",
      entityId: contract.id,
      ip: ctx.ip,
      payload: { userId: input.userId, files: input.attachmentIds.length },
    });
    return contract;
  }),

  update: protectedProcedure.input(updateContractSchema).mutation(async ({ ctx, input }) => {
    const existing = await requireContract(input.contractId);
    await assertCanPeople(ctx.user, existing.workspaceId, "contract:manage", {
      targetUserId: existing.userId,
    });
    assertDates(
      input.startDate ?? existing.startDate,
      input.expiryDate !== undefined ? input.expiryDate : existing.expiryDate,
    );
    const endChanged = input.expiryDate !== undefined && input.expiryDate !== existing.expiryDate;

    const [contract] = await db
      .update(schema.employmentContracts)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.contractType !== undefined ? { contractType: input.contractType } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate } : {}),
        // Spec §6: a changed end date gets its own alert.
        ...(endChanged ? { endAlertSentAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.employmentContracts.id, existing.id))
      .returning();
    if (!contract) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(
      existing.workspaceId,
      ctx.user.id,
      "contract",
      contract.id,
      "contract.updated",
      { userId: existing.userId },
    );
    await writeAudit({
      workspaceId: existing.workspaceId,
      actorId: ctx.user.id,
      action: "contract.updated",
      entity: "contract",
      entityId: contract.id,
      ip: ctx.ip,
      payload: {
        userId: existing.userId,
        ...(endChanged ? { endDate: { from: existing.expiryDate, to: input.expiryDate } } : {}),
      },
    });
    return contract;
  }),

  addFiles: protectedProcedure.input(addContractFilesSchema).mutation(async ({ ctx, input }) => {
    const existing = await requireContract(input.contractId);
    await assertCanPeople(ctx.user, existing.workspaceId, "contract:manage", {
      targetUserId: existing.userId,
    });
    await assertUnusedContractFiles(existing.workspaceId, input.attachmentIds);
    await appendFiles(existing.id, input.attachmentIds, ctx.user.id);
    await touchContract(existing.id, true);
    await logActivity(
      existing.workspaceId,
      ctx.user.id,
      "contract",
      existing.id,
      "contract.files_added",
      { userId: existing.userId, files: input.attachmentIds.length },
    );
    await writeAudit({
      workspaceId: existing.workspaceId,
      actorId: ctx.user.id,
      action: "contract.files_added",
      entity: "contract",
      entityId: existing.id,
      ip: ctx.ip,
      payload: { userId: existing.userId, files: input.attachmentIds.length },
    });
    return { id: existing.id };
  }),

  // Replaces one file; the old attachment row stays (still HR-only).
  replaceFile: protectedProcedure
    .input(replaceContractFileSchema)
    .mutation(async ({ ctx, input }) => {
      const { file, contract } = await requireContractFile(input.fileId);
      await assertCanPeople(ctx.user, contract.workspaceId, "contract:manage", {
        targetUserId: contract.userId,
      });
      await assertUnusedContractFiles(contract.workspaceId, [input.attachmentId]);
      await db
        .update(schema.contractFiles)
        .set({ attachmentId: input.attachmentId, uploadedBy: ctx.user.id, createdAt: new Date() })
        .where(eq(schema.contractFiles.id, file.id));
      await touchContract(contract.id, true);
      await logActivity(
        contract.workspaceId,
        ctx.user.id,
        "contract",
        contract.id,
        "contract.replaced",
        { userId: contract.userId, previousAttachmentId: file.attachmentId },
      );
      await writeAudit({
        workspaceId: contract.workspaceId,
        actorId: ctx.user.id,
        action: "contract.file_replaced",
        entity: "contract",
        entityId: contract.id,
        ip: ctx.ip,
        payload: {
          userId: contract.userId,
          fileId: file.id,
          previousAttachmentId: file.attachmentId,
        },
      });
      return { id: file.id };
    }),

  deleteFile: protectedProcedure.input(contractFileIdSchema).mutation(async ({ ctx, input }) => {
    const { file, contract } = await requireContractFile(input.fileId);
    await assertCanPeople(ctx.user, contract.workspaceId, "contract:manage", {
      targetUserId: contract.userId,
    });
    const live = await db
      .select({ id: schema.contractFiles.id })
      .from(schema.contractFiles)
      .where(
        and(
          eq(schema.contractFiles.contractId, contract.id),
          isNull(schema.contractFiles.deletedAt),
        ),
      );
    if (live.length <= 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This is the contract's only file — delete the contract instead",
      });
    }
    await db
      .update(schema.contractFiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.contractFiles.id, file.id));
    await touchContract(contract.id, false);
    await logActivity(
      contract.workspaceId,
      ctx.user.id,
      "contract",
      contract.id,
      "contract.file_deleted",
      { userId: contract.userId },
    );
    await writeAudit({
      workspaceId: contract.workspaceId,
      actorId: ctx.user.id,
      action: "contract.file_deleted",
      entity: "contract",
      entityId: contract.id,
      ip: ctx.ip,
      payload: { userId: contract.userId, fileId: file.id },
    });
    return { id: file.id };
  }),

  delete: protectedProcedure.input(contractIdSchema).mutation(async ({ ctx, input }) => {
    const existing = await requireContract(input.contractId);
    await assertCanPeople(ctx.user, existing.workspaceId, "contract:manage", {
      targetUserId: existing.userId,
    });
    await db
      .update(schema.employmentContracts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.employmentContracts.id, existing.id));
    await logActivity(
      existing.workspaceId,
      ctx.user.id,
      "contract",
      existing.id,
      "contract.deleted",
      { userId: existing.userId, title: existing.title },
    );
    await writeAudit({
      workspaceId: existing.workspaceId,
      actorId: ctx.user.id,
      action: "contract.deleted",
      entity: "contract",
      entityId: existing.id,
      ip: ctx.ip,
      payload: { userId: existing.userId, title: existing.title },
    });
    return { id: existing.id };
  }),

  // A 5-minute signed link to one file — for HR, or the employee themselves
  // (My contract). Every link handed out is in the audit log.
  fileUrl: protectedProcedure.input(contractFileUrlSchema).mutation(async ({ ctx, input }) => {
    const { file, contract } = await requireContractFile(input.fileId);
    if (contract.userId === ctx.user.id) {
      await requireActiveMember(ctx.user, contract.workspaceId);
    } else {
      await assertCanPeople(ctx.user, contract.workspaceId, "contract:manage", {
        targetUserId: contract.userId,
      });
    }
    const link = await signedDownloadUrl(file.attachmentId, input.disposition);
    await writeAudit({
      workspaceId: contract.workspaceId,
      actorId: ctx.user.id,
      action: input.disposition === "download" ? "contract.downloaded" : "contract.file_viewed",
      entity: "contract",
      entityId: contract.id,
      ip: ctx.ip,
      payload: { userId: contract.userId, fileId: file.id },
    });
    return link;
  }),
});
