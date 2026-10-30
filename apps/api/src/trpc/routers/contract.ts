import { db, schema } from "@canvas/db";
import {
  confirmDocumentSchema,
  contractIdSchema,
  contractsForPersonSchema,
  createContractSchema,
  presignDocumentSchema,
  todayReportDate,
  updateContractSchema,
  workspaceScopedSchema,
  daysUntil,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { getMembershipRole } from "../../lib/membership";
import { assertCanPeople, requireActiveMember } from "../../lib/permissions";
import {
  PRIVATE_PREFIXES,
  confirmPrivateUpload,
  presignPrivateUpload,
  requirePrivateAttachment,
  signedDownloadUrl,
} from "../../lib/private-upload";
import { protectedProcedure, router } from "../trpc";

const contractColumns = {
  id: schema.employmentContracts.id,
  workspaceId: schema.employmentContracts.workspaceId,
  userId: schema.employmentContracts.userId,
  userName: schema.users.name,
  kind: schema.employmentContracts.kind,
  parentContractId: schema.employmentContracts.parentContractId,
  title: schema.employmentContracts.title,
  startDate: schema.employmentContracts.startDate,
  expiryDate: schema.employmentContracts.expiryDate,
  attachmentId: schema.employmentContracts.attachmentId,
  fileName: schema.attachments.fileName,
  updatedAt: schema.employmentContracts.updatedAt,
};

function listContracts(where: ReturnType<typeof and>) {
  return db
    .select(contractColumns)
    .from(schema.employmentContracts)
    .innerJoin(schema.users, eq(schema.users.id, schema.employmentContracts.userId))
    .innerJoin(
      schema.attachments,
      eq(schema.attachments.id, schema.employmentContracts.attachmentId),
    )
    .where(and(where, isNull(schema.employmentContracts.deletedAt)))
    .orderBy(asc(schema.users.name), desc(schema.employmentContracts.startDate));
}

function withExpiry<T extends { expiryDate: string | null }>(rows: T[]) {
  const today = todayReportDate(new Date());
  return rows.map((r) => ({
    ...r,
    daysLeft: r.expiryDate ? daysUntil(today, r.expiryDate) : null,
  }));
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

async function assertUnusedContractFile(workspaceId: string, attachmentId: string) {
  await requirePrivateAttachment(PRIVATE_PREFIXES.contract, workspaceId, attachmentId);
  const used = await db.query.employmentContracts.findFirst({
    where: eq(schema.employmentContracts.attachmentId, attachmentId),
  });
  if (used) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is already filed" });
}

function assertDates(startDate: string, expiryDate: string | null | undefined) {
  if (expiryDate && expiryDate < startDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The expiry date is before the start" });
  }
}

export const contractRouter = router({
  // "My Contract": the caller's own documents only.
  mine: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    return withExpiry(
      await listContracts(
        and(
          eq(schema.employmentContracts.workspaceId, input.workspaceId),
          eq(schema.employmentContracts.userId, ctx.user.id),
        ),
      ),
    );
  }),

  // HR: every contract in the workspace, soonest expiry first in the UI.
  list: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "contract:manage");
    return withExpiry(
      await listContracts(eq(schema.employmentContracts.workspaceId, input.workspaceId)),
    );
  }),

  forPerson: protectedProcedure.input(contractsForPersonSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "contract:manage", {
      targetUserId: input.userId,
    });
    return withExpiry(
      await listContracts(
        and(
          eq(schema.employmentContracts.workspaceId, input.workspaceId),
          eq(schema.employmentContracts.userId, input.userId),
        ),
      ),
    );
  }),

  presignUpload: protectedProcedure
    .input(presignDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "contract:manage");
      return presignPrivateUpload(PRIVATE_PREFIXES.contract, input);
    }),

  confirmUpload: protectedProcedure
    .input(confirmDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "contract:manage");
      return confirmPrivateUpload(PRIVATE_PREFIXES.contract, ctx.user.id, input);
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
    await assertUnusedContractFile(input.workspaceId, input.attachmentId);

    const [contract] = await db
      .insert(schema.employmentContracts)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        kind: input.kind,
        parentContractId,
        title: input.title,
        startDate: input.startDate,
        expiryDate: input.expiryDate ?? null,
        attachmentId: input.attachmentId,
        uploadedBy: ctx.user.id,
      })
      .returning();
    if (!contract) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(input.workspaceId, ctx.user.id, "contract", contract.id, "contract.created", {
      userId: input.userId,
      kind: input.kind,
      title: input.title,
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
    if (input.attachmentId)
      await assertUnusedContractFile(existing.workspaceId, input.attachmentId);

    const [contract] = await db
      .update(schema.employmentContracts)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate } : {}),
        // Replacing the file keeps the old attachment row (HR-only from now on).
        ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
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
      input.attachmentId ? "contract.replaced" : "contract.updated",
      {
        userId: existing.userId,
        previousAttachmentId: input.attachmentId ? existing.attachmentId : undefined,
      },
    );
    return contract;
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
      {
        userId: existing.userId,
        title: existing.title,
      },
    );
    return { id: existing.id };
  }),

  // A short-lived signed link — only for the employee themselves or HR.
  downloadUrl: protectedProcedure.input(contractIdSchema).mutation(async ({ ctx, input }) => {
    const contract = await requireContract(input.contractId);
    if (contract.userId === ctx.user.id) {
      await requireActiveMember(ctx.user, contract.workspaceId);
    } else {
      await assertCanPeople(ctx.user, contract.workspaceId, "contract:manage", {
        targetUserId: contract.userId,
      });
    }
    return signedDownloadUrl(contract.attachmentId);
  }),
});
