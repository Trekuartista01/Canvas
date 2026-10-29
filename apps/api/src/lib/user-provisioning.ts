import { db, schema } from "@canvas/db";
import { eq } from "drizzle-orm";

/**
 * Find-or-create by email, never touching an existing row — extracted
 * from Google OAuth's callback (routes/auth.ts, M0.2). Safe for Google OAuth
 * because Google itself is the one vouching for control of the email at
 * login time.
 */
export async function findOrCreateUserByEmail(
  email: string,
  name: string,
  avatarUrl: string | null = null,
) {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) return existing;

  const [created] = await db
    .insert(schema.users)
    .values({ email, name, avatarUrl, passwordHash: null })
    .returning();
  if (!created) throw new Error("Failed to create user");
  return created;
}
