import { db, schema } from "@canvas/db";
import {
  companyDocumentDownloadSchema,
  companyDocumentIdSchema,
  confirmDocumentSchema,
  createCompanyDocumentSchema,
  documentCategoryIdSchema,
  documentCategorySchema,
  presignDocumentSchema,
  renameDocumentCategorySchema,
  replaceCompanyDocumentSchema,
  updateCompanyDocumentSchema,
  workspaceScopedSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { assertCanPeople, canPeopleAction, requireActiveMember } from "../../lib/permissions";
import {
  PRIVATE_PREFIXES,
  confirmPrivateUpload,
  presignPrivateUpload,
  requirePrivateAttachment,
  signedDownloadUrl,
} from "../../lib/private-upload";
import { protectedProcedure, router } from "../trpc";

async function requireDocument(documentId: string) {
  const document = await db.query.companyDocuments.findFirst({
    where: and(
      eq(schema.companyDocuments.id, documentId),
      isNull(schema.companyDocuments.deletedAt),
    ),
  });
  if (!document) throw new TRPCError({ code: "NOT_FOUND" });
  return document;
}

async function requireCategory(categoryId: string) {
  const category = await db.query.companyDocumentCategories.findFirst({
    where: and(
      eq(schema.companyDocumentCategories.id, categoryId),
      isNull(schema.companyDocumentCategories.deletedAt),
    ),
  });
  if (!category) throw new TRPCError({ code: "NOT_FOUND" });
  return category;
}

async function assertCategoryInWorkspace(
  workspaceId: string,
  categoryId: string | null | undefined,
) {
  if (!categoryId) return;
  const category = await requireCategory(categoryId);
  if (category.workspaceId !== workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
}

// A fresh company-documents upload that no document version uses yet.
async function assertUnusedFile(workspaceId: string, attachmentId: string) {
  await requirePrivateAttachment(PRIVATE_PREFIXES.companyDocument, workspaceId, attachmentId);
  const used = await db.query.companyDocumentVersions.findFirst({
    where: eq(schema.companyDocumentVersions.attachmentId, attachmentId),
  });
  if (used) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is already filed" });
}

export const companyDocumentRouter = router({
  // Everyone: categories and documents (current version), plus whether the
  // caller manages the library.
  list: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const [categories, documents, canManage] = await Promise.all([
      db
        .select({
          id: schema.companyDocumentCategories.id,
          name: schema.companyDocumentCategories.name,
        })
        .from(schema.companyDocumentCategories)
        .where(
          and(
            eq(schema.companyDocumentCategories.workspaceId, input.workspaceId),
            isNull(schema.companyDocumentCategories.deletedAt),
          ),
        )
        .orderBy(asc(schema.companyDocumentCategories.name)),
      db
        .select({
          id: schema.companyDocuments.id,
          categoryId: schema.companyDocuments.categoryId,
          title: schema.companyDocuments.title,
          fileName: schema.attachments.fileName,
          sizeBytes: schema.attachments.sizeBytes,
          updatedAt: schema.companyDocuments.updatedAt,
        })
        .from(schema.companyDocuments)
        .innerJoin(
          schema.attachments,
          eq(schema.attachments.id, schema.companyDocuments.attachmentId),
        )
        .where(
          and(
            eq(schema.companyDocuments.workspaceId, input.workspaceId),
            isNull(schema.companyDocuments.deletedAt),
          ),
        )
        .orderBy(asc(schema.companyDocuments.title)),
      canPeopleAction(ctx.user, input.workspaceId, "companyDocument:manage"),
    ]);
    const versionCounts =
      documents.length > 0
        ? await db
            .select({ documentId: schema.companyDocumentVersions.documentId, n: count() })
            .from(schema.companyDocumentVersions)
            .where(
              inArray(
                schema.companyDocumentVersions.documentId,
                documents.map((d) => d.id),
              ),
            )
            .groupBy(schema.companyDocumentVersions.documentId)
        : [];
    const versionsOf = new Map(versionCounts.map((v) => [v.documentId, v.n]));
    // A document whose category was deleted shows under "Other".
    const liveCategories = new Set(categories.map((c) => c.id));
    return {
      categories,
      documents: documents.map((d) => ({
        ...d,
        categoryId: d.categoryId && liveCategories.has(d.categoryId) ? d.categoryId : null,
        versionCount: versionsOf.get(d.id) ?? 1,
      })),
      canManage,
    };
  }),

  versions: protectedProcedure.input(companyDocumentIdSchema).query(async ({ ctx, input }) => {
    const document = await requireDocument(input.documentId);
    await requireActiveMember(ctx.user, document.workspaceId);
    const versions = await db
      .select({
        id: schema.companyDocumentVersions.id,
        version: schema.companyDocumentVersions.version,
        fileName: schema.attachments.fileName,
        uploadedByName: schema.users.name,
        createdAt: schema.companyDocumentVersions.createdAt,
        attachmentId: schema.companyDocumentVersions.attachmentId,
      })
      .from(schema.companyDocumentVersions)
      .innerJoin(
        schema.attachments,
        eq(schema.attachments.id, schema.companyDocumentVersions.attachmentId),
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.companyDocumentVersions.uploadedBy))
      .where(eq(schema.companyDocumentVersions.documentId, document.id))
      .orderBy(desc(schema.companyDocumentVersions.version));
    return versions.map(({ attachmentId, ...v }) => ({
      ...v,
      isCurrent: attachmentId === document.attachmentId,
    }));
  }),

  createCategory: protectedProcedure
    .input(documentCategorySchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "companyDocument:manage");
      const [category] = await db
        .insert(schema.companyDocumentCategories)
        .values({ workspaceId: input.workspaceId, name: input.name })
        .returning();
      if (!category) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await logActivity(
        input.workspaceId,
        ctx.user.id,
        "document_category",
        category.id,
        "document_category.created",
        {
          name: category.name,
        },
      );
      return category;
    }),

  renameCategory: protectedProcedure
    .input(renameDocumentCategorySchema)
    .mutation(async ({ ctx, input }) => {
      const category = await requireCategory(input.categoryId);
      await assertCanPeople(ctx.user, category.workspaceId, "companyDocument:manage");
      await db
        .update(schema.companyDocumentCategories)
        .set({ name: input.name })
        .where(eq(schema.companyDocumentCategories.id, category.id));
      await logActivity(
        category.workspaceId,
        ctx.user.id,
        "document_category",
        category.id,
        "document_category.renamed",
        {
          from: category.name,
          to: input.name,
        },
      );
      return { id: category.id };
    }),

  deleteCategory: protectedProcedure
    .input(documentCategoryIdSchema)
    .mutation(async ({ ctx, input }) => {
      const category = await requireCategory(input.categoryId);
      await assertCanPeople(ctx.user, category.workspaceId, "companyDocument:manage");
      await db
        .update(schema.companyDocumentCategories)
        .set({ deletedAt: new Date() })
        .where(eq(schema.companyDocumentCategories.id, category.id));
      await logActivity(
        category.workspaceId,
        ctx.user.id,
        "document_category",
        category.id,
        "document_category.deleted",
        {
          name: category.name,
        },
      );
      return { id: category.id };
    }),

  presignUpload: protectedProcedure
    .input(presignDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "companyDocument:manage");
      return presignPrivateUpload(PRIVATE_PREFIXES.companyDocument, input);
    }),

  confirmUpload: protectedProcedure
    .input(confirmDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "companyDocument:manage");
      return confirmPrivateUpload(PRIVATE_PREFIXES.companyDocument, ctx.user.id, input);
    }),

  create: protectedProcedure.input(createCompanyDocumentSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "companyDocument:manage");
    await assertCategoryInWorkspace(input.workspaceId, input.categoryId);
    await assertUnusedFile(input.workspaceId, input.attachmentId);

    const document = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.companyDocuments)
        .values({
          workspaceId: input.workspaceId,
          categoryId: input.categoryId,
          title: input.title,
          attachmentId: input.attachmentId,
          uploadedBy: ctx.user.id,
        })
        .returning();
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx.insert(schema.companyDocumentVersions).values({
        documentId: created.id,
        attachmentId: input.attachmentId,
        version: 1,
        uploadedBy: ctx.user.id,
      });
      return created;
    });
    await logActivity(
      input.workspaceId,
      ctx.user.id,
      "company_document",
      document.id,
      "company_document.created",
      {
        title: document.title,
      },
    );
    return document;
  }),

  // A new file for an existing document: becomes the current version, the
  // previous ones stay downloadable from its history.
  replace: protectedProcedure
    .input(replaceCompanyDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await requireDocument(input.documentId);
      await assertCanPeople(ctx.user, existing.workspaceId, "companyDocument:manage");
      await assertUnusedFile(existing.workspaceId, input.attachmentId);

      const version = await db.transaction(async (tx) => {
        const [latest] = await tx
          .select({ v: max(schema.companyDocumentVersions.version) })
          .from(schema.companyDocumentVersions)
          .where(eq(schema.companyDocumentVersions.documentId, existing.id));
        const next = (latest?.v ?? 0) + 1;
        await tx.insert(schema.companyDocumentVersions).values({
          documentId: existing.id,
          attachmentId: input.attachmentId,
          version: next,
          uploadedBy: ctx.user.id,
        });
        await tx
          .update(schema.companyDocuments)
          .set({ attachmentId: input.attachmentId, uploadedBy: ctx.user.id, updatedAt: new Date() })
          .where(eq(schema.companyDocuments.id, existing.id));
        return next;
      });
      await logActivity(
        existing.workspaceId,
        ctx.user.id,
        "company_document",
        existing.id,
        "company_document.replaced",
        {
          title: existing.title,
          version,
        },
      );
      return { id: existing.id, version };
    }),

  update: protectedProcedure.input(updateCompanyDocumentSchema).mutation(async ({ ctx, input }) => {
    const existing = await requireDocument(input.documentId);
    await assertCanPeople(ctx.user, existing.workspaceId, "companyDocument:manage");
    await assertCategoryInWorkspace(existing.workspaceId, input.categoryId);
    await db
      .update(schema.companyDocuments)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.companyDocuments.id, existing.id));
    await logActivity(
      existing.workspaceId,
      ctx.user.id,
      "company_document",
      existing.id,
      "company_document.updated",
      {
        title: input.title ?? existing.title,
      },
    );
    return { id: existing.id };
  }),

  delete: protectedProcedure.input(companyDocumentIdSchema).mutation(async ({ ctx, input }) => {
    const existing = await requireDocument(input.documentId);
    await assertCanPeople(ctx.user, existing.workspaceId, "companyDocument:manage");
    await db
      .update(schema.companyDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.companyDocuments.id, existing.id));
    await logActivity(
      existing.workspaceId,
      ctx.user.id,
      "company_document",
      existing.id,
      "company_document.deleted",
      {
        title: existing.title,
      },
    );
    return { id: existing.id };
  }),

  downloadUrl: protectedProcedure
    .input(companyDocumentDownloadSchema)
    .mutation(async ({ ctx, input }) => {
      const document = await requireDocument(input.documentId);
      await requireActiveMember(ctx.user, document.workspaceId);
      let attachmentId = document.attachmentId;
      if (input.versionId) {
        const version = await db.query.companyDocumentVersions.findFirst({
          where: and(
            eq(schema.companyDocumentVersions.id, input.versionId),
            eq(schema.companyDocumentVersions.documentId, document.id),
          ),
        });
        if (!version) throw new TRPCError({ code: "NOT_FOUND" });
        attachmentId = version.attachmentId;
      }
      return signedDownloadUrl(attachmentId);
    }),
});
