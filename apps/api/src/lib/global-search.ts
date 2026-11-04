import { db, schema } from "@canvas/db";
import { searchTokens } from "@canvas/shared";
import { and, count, desc, eq, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import { activeMembershipCondition } from "./membership";
import { canPeopleAction } from "./permissions";

const GROUP_LIMIT = 20;

/**
 * Every word of the query appears somewhere in these columns, ignoring case
 * and the Albanian ë and ç ("lendita" finds "Lëndita"). Never true for a query
 * with no words.
 */
function matchesAllWords(query: string, columns: (AnyColumn | SQL)[]): SQL {
  const words = searchTokens(query);
  if (words.length === 0) return sql`false`;
  const text = sql.join(
    columns.map((c) => sql`coalesce(${c}, '')`),
    sql` || ' ' || `,
  );
  const folded = sql`translate(lower(${text}), 'ëç', 'ec')`;
  return and(...words.map((word) => sql`${folded} LIKE ${`%${word}%`}`))!;
}

/**
 * The tasks a member may find. task.search and search.global both come here,
 * so board membership (P8.9) has one place to go.
 */
export async function searchVisibleTasks(workspaceId: string, query: string) {
  const tsquery = sql`websearch_to_tsquery('english', ${query})`;
  const rank = sql<number>`ts_rank(${schema.tasks.searchVector}, ${tsquery})`;
  return db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      listId: schema.tasks.listId,
      listName: schema.lists.name,
      spaceName: schema.spaces.name,
    })
    .from(schema.tasks)
    .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
    .where(
      and(
        eq(schema.spaces.workspaceId, workspaceId),
        isNull(schema.tasks.deletedAt),
        isNull(schema.lists.deletedAt),
        isNull(schema.spaces.deletedAt),
        sql`${schema.tasks.searchVector} @@ ${tsquery}`,
      ),
    )
    .orderBy(desc(rank))
    .limit(GROUP_LIMIT);
}

/** Directory cards: public fields only. Archived people are found by HR alone. */
async function searchPeople(workspaceId: string, query: string, includeArchived: boolean) {
  return db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      jobTitle: schema.employeeProfiles.jobTitle,
      department: schema.employeeProfiles.department,
      archived: sql<boolean>`${schema.employeeProfiles.status} = 'inactive'`,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        includeArchived ? undefined : activeMembershipCondition,
        matchesAllWords(query, [
          schema.users.name,
          schema.users.email,
          schema.employeeProfiles.jobTitle,
          schema.employeeProfiles.department,
        ]),
      ),
    )
    .orderBy(schema.users.name)
    .limit(GROUP_LIMIT);
}

async function searchContracts(workspaceId: string, query: string) {
  return db
    .select({
      id: schema.employmentContracts.id,
      userId: schema.employmentContracts.userId,
      userName: schema.users.name,
      title: schema.employmentContracts.title,
      kind: schema.employmentContracts.kind,
      endDate: schema.employmentContracts.expiryDate,
      files: count(schema.contractFiles.id),
    })
    .from(schema.employmentContracts)
    .innerJoin(schema.users, eq(schema.users.id, schema.employmentContracts.userId))
    .leftJoin(
      schema.contractFiles,
      and(
        eq(schema.contractFiles.contractId, schema.employmentContracts.id),
        isNull(schema.contractFiles.deletedAt),
      ),
    )
    .where(
      and(
        eq(schema.employmentContracts.workspaceId, workspaceId),
        isNull(schema.employmentContracts.deletedAt),
        matchesAllWords(query, [schema.users.name, schema.employmentContracts.title]),
      ),
    )
    .groupBy(schema.employmentContracts.id, schema.users.name)
    .orderBy(schema.users.name)
    .limit(GROUP_LIMIT);
}

/** That a record exists and who it's for: amounts stay on the Payroll page. */
async function searchPayroll(workspaceId: string, query: string) {
  return db
    .select({
      userId: schema.payrollRecords.userId,
      userName: schema.users.name,
      updatedAt: schema.payrollRecords.updatedAt,
    })
    .from(schema.payrollRecords)
    .innerJoin(schema.users, eq(schema.users.id, schema.payrollRecords.userId))
    .where(
      and(
        eq(schema.payrollRecords.workspaceId, workspaceId),
        matchesAllWords(query, [schema.users.name]),
      ),
    )
    .orderBy(schema.users.name)
    .limit(GROUP_LIMIT);
}

const leaveColumns = {
  id: schema.leaveRequests.id,
  userId: schema.leaveRequests.userId,
  userName: schema.users.name,
  type: schema.leaveRequests.type,
  startDate: schema.leaveRequests.startDate,
  endDate: schema.leaveRequests.endDate,
  status: schema.leaveRequests.status,
};

async function searchLeave(workspaceId: string, query: string, vendimsOnly: boolean) {
  return db
    .select(leaveColumns)
    .from(schema.leaveRequests)
    .innerJoin(schema.users, eq(schema.users.id, schema.leaveRequests.userId))
    .where(
      and(
        eq(schema.leaveRequests.workspaceId, workspaceId),
        matchesAllWords(query, [schema.users.name]),
        vendimsOnly
          ? or(
              sql`${schema.leaveRequests.vendimPdfKey} IS NOT NULL`,
              sql`${schema.leaveRequests.vendimDocxKey} IS NOT NULL`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.leaveRequests.startDate))
    .limit(GROUP_LIMIT);
}

/**
 * P8.8 (spec §9): what this caller may find, decided before anything is
 * searched. A scope the caller lacks is never queried, so its rows are neither
 * ranked nor counted, and its key is absent from the response.
 *
 * - Shared (everyone): directory cards and tasks.
 * - HR (each group by its own permission, hr_finance only): contracts, payroll
 *   entries, leave requests, Vendims.
 * - Ops: clients and client folders join here with P8.10, behind clients:manage.
 *
 * None of this uses embeddings: HR records are never sent to the embedding
 * provider, so there is no AI index for confidential data to leak from.
 */
export async function globalSearch(user: SessionUser, workspaceId: string, query: string) {
  const [canDirectory, canManageStaff, canContracts, canPayroll, canLeave] = await Promise.all([
    canPeopleAction(user, workspaceId, "people:viewDirectory"),
    canPeopleAction(user, workspaceId, "people:manageStaff"),
    canPeopleAction(user, workspaceId, "contract:manage"),
    canPeopleAction(user, workspaceId, "payroll:view"),
    canPeopleAction(user, workspaceId, "leave:approve"),
  ]);

  const [people, tasks] = await Promise.all([
    canDirectory ? searchPeople(workspaceId, query, canManageStaff) : [],
    searchVisibleTasks(workspaceId, query),
  ]);
  const shared = { people, tasks };
  if (!canContracts && !canPayroll && !canLeave) return shared;

  const [contracts, payroll, leave, vendims] = await Promise.all([
    canContracts ? searchContracts(workspaceId, query) : [],
    canPayroll ? searchPayroll(workspaceId, query) : [],
    canLeave ? searchLeave(workspaceId, query, false) : [],
    canLeave ? searchLeave(workspaceId, query, true) : [],
  ]);
  return { ...shared, hr: { contracts, payroll, leave, vendims } };
}
