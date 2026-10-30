/**
 * M7.9 step 1 — inspect the old Seri data. Read-only: nothing is written to
 * Canvas or to Seri.
 *
 *   pnpm --filter @canvas/api seri:inspect -- --dir <mongodump-or-mongoexport-folder>
 *   MONGO_URL=mongodb+srv://readonly@… pnpm --filter @canvas/api seri:inspect -- [--db seri]
 *
 * Writes <out>/inspection.json and <out>/SERI_INSPECTION.md (default out:
 * .seri-import/ in the repo root, which is gitignored). Values of
 * personal-looking fields are redacted, but the output still describes
 * people's records — don't commit or share it beyond writing the mapping.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  renderInspectionMarkdown,
  summarizeCollection,
} from "../../src/lib/seri-import/field-stats";
import {
  readDumpFolder,
  readMongo,
  type SourceCollection,
} from "../../src/lib/seri-import/read-source";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SAMPLE = Number(arg("sample") ?? 2000);
const out = resolve(arg("out") ?? resolve(import.meta.dirname, "../../../../.seri-import"));
const dir = arg("dir");
const mongoUrl = process.env.MONGO_URL;

if (!dir && !mongoUrl) {
  console.error("Give --dir <folder> (mongodump/mongoexport) or set MONGO_URL (read-only).");
  process.exit(1);
}

let collections: SourceCollection[];
let close = async () => {};
let source: string;
if (dir) {
  collections = await readDumpFolder(resolve(dir));
  source = `folder ${resolve(dir)}`;
} else {
  const mongo = await readMongo(mongoUrl!, arg("db"));
  collections = mongo.collections;
  close = mongo.close;
  source = `MongoDB ${arg("db") ?? "(default database)"}`;
}

const summaries = [];
for (const collection of collections) {
  const docs = [];
  for await (const doc of collection.read(SAMPLE)) docs.push(doc);
  summaries.push(summarizeCollection(collection.name, docs, collection.count));
  console.log(`${collection.name.padEnd(32)} ${String(collection.count).padStart(8)} documents`);
}
await close();

await mkdir(out, { recursive: true });
await writeFile(
  resolve(out, "inspection.json"),
  JSON.stringify({ source, collections: summaries }, null, 2),
);
await writeFile(resolve(out, "SERI_INSPECTION.md"), renderInspectionMarkdown(source, summaries));
console.log(`\nWrote ${resolve(out, "SERI_INSPECTION.md")}`);
