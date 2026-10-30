import { db, schema } from "@canvas/db";
import { contractNoticesDue, daysUntil, todayReportDate } from "@canvas/shared";
import { and, eq, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { getEmailClient } from "../email";
import { env } from "../env";
import { logActivity } from "./activity";
import { listActiveMemberIds } from "./membership";
import { notifyUsers } from "./notify";

/** Who looks after contracts: HR and super admins (the owner always is one). */
async function contractManagerIds(workspaceId: string) {
  return listActiveMemberIds(
    workspaceId,
    or(
      inArray(schema.memberships.peopleRole, ["hr", "super_admin"]),
      eq(schema.memberships.role, "owner"),
    ),
  );
}

/**
 * M7.6: tells HR 30 and 7 days before an employment contract (or annex)
 * expires — in-app and by email. Runs on every scheduler tick; each
 * (contract, threshold, expiry date) is claimed in contract_expiry_notices
 * before anything is sent, so it goes out once. Thresholds that become due
 * together (a contract filed 5 days before it ends) produce one message.
 */
export async function sendContractExpiryNotices(now = new Date()) {
  const today = todayReportDate(now);
  const expiring = await db
    .select({
      id: schema.employmentContracts.id,
      workspaceId: schema.employmentContracts.workspaceId,
      userId: schema.employmentContracts.userId,
      title: schema.employmentContracts.title,
      expiryDate: schema.employmentContracts.expiryDate,
      employeeName: schema.users.name,
    })
    .from(schema.employmentContracts)
    .innerJoin(schema.users, eq(schema.users.id, schema.employmentContracts.userId))
    .where(
      and(
        isNull(schema.employmentContracts.deletedAt),
        isNotNull(schema.employmentContracts.expiryDate),
        gte(schema.employmentContracts.expiryDate, today),
      ),
    );

  const emailClient = getEmailClient();
  for (const contract of expiring) {
    const expiryDate = contract.expiryDate!;
    const due = contractNoticesDue(today, expiryDate);
    if (due.length === 0) continue;

    const claimed = await db
      .insert(schema.contractExpiryNotices)
      .values(due.map((thresholdDays) => ({ contractId: contract.id, thresholdDays, expiryDate })))
      .onConflictDoNothing()
      .returning();
    if (claimed.length === 0) continue;

    const recipients = (await contractManagerIds(contract.workspaceId)).filter(
      (id) => id !== contract.userId,
    );
    if (recipients.length === 0) continue;
    const daysLeft = daysUntil(today, expiryDate);

    // Scheduler-sent: the employee is the activity's subject, so they're its actor.
    const activity = await logActivity(
      contract.workspaceId,
      contract.userId,
      "contract",
      contract.id,
      "contract.expiring",
      {
        userId: contract.userId,
        employeeName: contract.employeeName,
        title: contract.title,
        expiryDate,
        daysLeft,
      },
    );
    await notifyUsers(activity.id, recipients);

    const people = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, recipients));
    for (const { email } of people) {
      try {
        await emailClient.send({
          to: email,
          subject: `Contract expiring in ${daysLeft} day${daysLeft === 1 ? "" : "s"}: ${contract.employeeName}`,
          text: [
            `${contract.employeeName}'s "${contract.title}" expires on ${expiryDate}.`,
            "",
            `Contracts: ${env.WEB_URL}/w/${contract.workspaceId}/contracts`,
          ].join("\n"),
        });
      } catch (err) {
        console.error(`[scheduler] contract expiry email to ${email} failed:`, err);
      }
    }
  }
}
