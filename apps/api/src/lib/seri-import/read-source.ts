import { deserialize, EJSON, type Document } from "bson";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

/**
 * M7.9: read the old Seri data from either
 * - a folder of `mongodump` output (`<collection>.bson`, metadata skipped), or
 * - `mongoexport` JSON (`<collection>.json`: one Extended-JSON document per
 *   line, or a `--jsonArray` array), possibly in sub-folders;
 * - or a live, read-only MONGO_URL.
 * Every reader yields plain documents per collection; nothing is written.
 */
export interface SourceCollection {
  name: string;
  count: number;
  /** Streams the documents (all of them, or up to `limit`). */
  read(limit?: number): AsyncIterable<Document>;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

/** Splits a mongodump .bson file into documents (each starts with its int32 length). */
export function* bsonDocuments(bytes: Uint8Array): Generator<Document> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const size = buffer.readInt32LE(offset);
    if (size < 5 || offset + size > buffer.length)
      throw new Error(`Corrupt BSON at byte ${offset}`);
    yield deserialize(buffer.subarray(offset, offset + size), { promoteBuffers: true });
    offset += size;
  }
}

/** mongoexport output: a JSON array, or one Extended-JSON document per line. */
export function jsonDocuments(text: string): Document[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return EJSON.parse(trimmed, { relaxed: false }) as Document[];
  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => EJSON.parse(line, { relaxed: false }) as Document);
}

export async function readDumpFolder(dir: string): Promise<SourceCollection[]> {
  if (!(await stat(dir)).isDirectory()) throw new Error(`${dir} is not a folder`);
  const files = (await walk(dir)).filter((f) => {
    const ext = extname(f).toLowerCase();
    return (ext === ".bson" || ext === ".json") && !f.endsWith(".metadata.json");
  });
  const collections: SourceCollection[] = [];
  for (const file of files.sort()) {
    const name = basename(file, extname(file));
    const docs =
      extname(file).toLowerCase() === ".bson"
        ? [...bsonDocuments(await readFile(file))]
        : jsonDocuments(await readFile(file, "utf8"));
    collections.push({
      name,
      count: docs.length,
      async *read(limit) {
        yield* docs.slice(0, limit ?? docs.length);
      },
    });
  }
  return collections;
}

export async function readMongo(url: string, dbName?: string) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url, { readPreference: "secondaryPreferred" });
  await client.connect();
  const db = client.db(dbName);
  const infos = await db.listCollections({}, { nameOnly: true }).toArray();
  const collections: SourceCollection[] = [];
  for (const info of infos.sort((a, b) => a.name.localeCompare(b.name))) {
    if (info.name.startsWith("system.")) continue;
    const collection = db.collection(info.name);
    collections.push({
      name: info.name,
      count: await collection.estimatedDocumentCount(),
      async *read(limit) {
        const cursor = collection.find({}, limit ? { limit } : {});
        for await (const doc of cursor) yield doc;
      },
    });
  }
  return { collections, close: () => client.close() };
}
