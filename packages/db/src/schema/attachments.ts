import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { comments } from "./comments";
import { imageAssets } from "./image-brain";
import { tasks } from "./tasks";
import { workspaces } from "./workspaces";

// M5.6: an attachment linked in from Google Drive (picker/paste-link, see
// PROGRESS.md decisions) has no S3 object of its own — `fileKey`/
// `sizeBytes` stay null for it, `externalUrl` holds the Drive file's link
// instead. "upload" is every attachment from before this milestone.
export const attachmentSource = pgEnum("attachment_source", ["upload", "google_drive"]);

// DATA_MODEL.md's `attachments` row has no `deleted_at` (unlike `tasks`/
// `comments`) — hard delete, same precedent as M1.6's checklists/M1.8's
// task_tags. `thumbKey`/`blurhash`/`width`/`height` are additive beyond
// DATA_MODEL.md's literal row: CLAUDE.md's UI hard rule ("blurhash
// placeholder -> thumb -> full-res") needs somewhere to live, and the
// Phase-2 `image_versions` table that would normally hold this doesn't
// exist yet. Nullable — only ever set when `mime` is an image type. Named
// to match `image_versions`' shape so a future Image Brain migration can
// reuse the convention. See PROGRESS.md (M1.9 decisions).
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Set when this attachment originated from (or was attached from) the
    // Image Brain rather than a plain upload. DATA_MODEL.md always listed
    // this column; M1.9 deliberately left it out because `image_assets`
    // didn't exist yet, flagging it as "add when M2.1 creates image_assets"
    // — this is that. Still unused by any app code (nothing links an
    // attachment to an image_asset yet — that's M2.3's `attach_to_task`
    // tool), same "schema supports it, nothing sets it yet" precedent as
    // M1.8's workspace-wide custom field defs.
    imageAssetId: uuid("image_asset_id").references(() => imageAssets.id),
    source: attachmentSource("source").notNull().default("upload"),
    // M7.2: an image that proves the work was done — a task with
    // requires_proof can't be submitted for review without one.
    isProof: boolean("is_proof").notNull().default(false),
    // Nullable, unlike the rest of M1.9's original columns — only a
    // "google_drive" source attachment (no S3 object) leaves these null.
    fileKey: text("file_key"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes"),
    externalUrl: text("external_url"),
    thumbKey: text("thumb_key"),
    blurhash: text("blurhash"),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("attachments_task_id_idx").on(table.taskId)],
);
