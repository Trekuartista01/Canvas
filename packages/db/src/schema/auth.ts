import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  // Cosmetic profile tag (e.g. "Product Designer") — deliberately NOT named
  // `role`: that word already means the governed workspace-membership rank
  // (owner/admin/member/guest) that can()/ROLE_RANK check. This field has
  // no effect on permissions.
  title: text("title"),
  passwordHash: text("password_hash"),
  // M3.9: the cursor for the email digest — only notifications created
  // after this (or after createdAt, if never sent) go into the next
  // digest. Not in DATA_MODEL.md's compact `users` row; see PROGRESS.md.
  lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// A sign-up waiting on its emailed link. There's no users row until the link is
// opened and a password chosen, so an unconfirmed address owns nothing. Only the
// token's hash is stored. invite_id and requested_role are copied in unchecked
// and checked again when the link is opened.
export const signupRequests = pgTable(
  "signup_requests",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    email: text("email").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    inviteId: uuid("invite_id"),
    requestedRole: text("requested_role"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("signup_requests_email_idx").on(table.email)],
);
