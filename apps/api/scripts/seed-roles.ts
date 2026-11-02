/**
 * P8.1 one-off bootstrap: sets the first HR/Finance Manager(s), Operations
 * Manager(s) and CEOs by email (docs/hr-ops-spec.md §1):
 *
 *   pnpm seed:roles
 *
 * with SEED_HR_EMAILS / SEED_OPS_EMAILS / SEED_CEO_EMAILS (comma separated)
 * in .env or the environment. Everyone must already be a member of the
 * workspace. SEED_WORKSPACE_ID picks the workspace; it may be left out when
 * there's only one. Refuses once the workspace has an HR user — after that,
 * admin assigns roles in the app. Every change is written to audit_log (no
 * actor: it's the system).
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
config({ path: resolve(root, ".env"), quiet: true });

// After .env: @canvas/db builds its pool from process.env when imported.
const { db, schema } = await import("@canvas/db");
const { eq } = await import("drizzle-orm");
const { effectivePeopleRole } = await import("@canvas/shared");
const { planSeedRoles } = await import("../src/lib/seed-roles");

async function main() {
  let workspaceId = process.env.SEED_WORKSPACE_ID;
  if (!workspaceId) {
    const all = await db.select({ id: schema.workspaces.id }).from(schema.workspaces);
    if (all.length !== 1) {
      throw new Error(`There are ${all.length} workspaces — set SEED_WORKSPACE_ID to pick one`);
    }
    workspaceId = all[0]!.id;
  }

  const rows = await db
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      email: schema.users.email,
      membershipRole: schema.memberships.role,
      storedPeopleRole: schema.memberships.peopleRole,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.workspaceId, workspaceId));
  const members = rows.map(({ storedPeopleRole, ...r }) => ({
    ...r,
    peopleRole: effectivePeopleRole(r.membershipRole, storedPeopleRole),
  }));

  const { assignments, errors } = planSeedRoles(process.env, members);
  if (errors.length > 0) throw new Error(`Nothing changed:\n- ${errors.join("\n- ")}`);

  await db.transaction(async (tx) => {
    for (const a of assignments) {
      await tx
        .update(schema.memberships)
        .set({ peopleRole: a.to })
        .where(eq(schema.memberships.id, a.membershipId));
      await tx.insert(schema.auditLog).values({
        workspaceId: workspaceId!,
        actorId: null,
        action: "person.role_changed",
        entity: "person",
        entityId: a.userId,
        payloadJson: { from: a.from, to: a.to, source: "seed:roles" },
      });
    }
  });
  for (const a of assignments) console.log(`seed:roles: ${a.email} → ${a.to}`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
