import { EJSON, ObjectId, serialize } from "bson";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bsonDocuments, jsonDocuments, readDumpFolder } from "./read-source";

const a = { _id: new ObjectId(), title: "Visit store", dueAt: new Date("2025-03-01T10:00:00Z") };
const b = { _id: new ObjectId(), title: "Restock", done: true };

describe("bson/json readers", () => {
  it("splits a mongodump .bson stream", () => {
    const docs = [...bsonDocuments(Buffer.concat([serialize(a), serialize(b)]))];
    expect(docs.map((d) => d.title)).toEqual(["Visit store", "Restock"]);
    expect(docs[0]!.dueAt).toBeInstanceOf(Date);
  });

  it("rejects a truncated file", () => {
    expect(() => [...bsonDocuments(serialize(a).subarray(0, 10))]).toThrow(/Corrupt/);
  });

  it("parses mongoexport lines and --jsonArray", () => {
    const lines = [
      EJSON.stringify(a, { relaxed: false }),
      EJSON.stringify(b, { relaxed: false }),
    ].join("\n");
    expect(jsonDocuments(lines)).toHaveLength(2);
    expect(jsonDocuments(`[${lines.replace("\n", ",")}]`)[1]!.title).toBe("Restock");
    expect(jsonDocuments(lines)[0]!._id).toBeInstanceOf(ObjectId);
  });
});

describe("readDumpFolder", () => {
  it("finds collections in nested folders and skips metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seri-"));
    await mkdir(join(dir, "seri"));
    await writeFile(join(dir, "seri", "tasks.bson"), Buffer.concat([serialize(a), serialize(b)]));
    await writeFile(join(dir, "seri", "tasks.metadata.json"), "{}");
    await writeFile(
      join(dir, "users.json"),
      EJSON.stringify({ _id: new ObjectId() }, { relaxed: false }),
    );
    const collections = await readDumpFolder(dir);
    expect(collections.map((c) => [c.name, c.count])).toEqual([
      ["tasks", 2],
      ["users", 1],
    ]);
    const first: unknown[] = [];
    for await (const doc of collections[0]!.read(1)) first.push(doc);
    expect(first).toHaveLength(1);
  });
});
