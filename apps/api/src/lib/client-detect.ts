import { db, schema } from "@canvas/db";
import { matchClients } from "@canvas/shared";
import { and, eq, isNull } from "drizzle-orm";

/** The workspace's live clients whose name or alias appears in this text. */
export async function detectClients(workspaceId: string, text: string) {
  const clients = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      aliases: schema.clients.aliases,
      color: schema.clients.color,
    })
    .from(schema.clients)
    .where(and(eq(schema.clients.workspaceId, workspaceId), isNull(schema.clients.archivedAt)));
  return matchClients(text, clients);
}

/** The client a brand-new card starts with: only when exactly one is mentioned. */
export async function clientForNewCard(workspaceId: string, title: string) {
  const matches = await detectClients(workspaceId, title);
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

/** A card's text as matching sees it. */
export function cardText(task: { title: string; descriptionText: string | null }) {
  return `${task.title}\n${task.descriptionText ?? ""}`;
}
