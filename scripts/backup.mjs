/**
 * Snapshot the local D1 database to a timestamped .sql file.
 *
 * Most of what the app stores can be rebuilt: modules and assignments come
 * from the committed seed, calendar events from the subscribed .ics URL. Two
 * tables cannot. Grades and time sessions are records of things that happened
 * -- a mark received, an hour actually worked -- and no source of truth for
 * them exists outside this database. Losing .wrangler/state loses those
 * permanently, and nothing about that failure announces itself.
 *
 * A SQL dump rather than a copy of the SQLite file: it survives a change of
 * SQLite version, can be read and repaired in a text editor, and diffs
 * usefully against the previous snapshot.
 *
 * Data only, no schema. The schema already lives in db/migrations under
 * version control, so snapshotting it would duplicate the one copy that is
 * authoritative. It also cannot be replayed: wrangler emits each table's
 * CREATE followed by its own INSERTs, so a child table's rows are inserted
 * before the parent table exists and SQLite rejects the whole file with
 * "no such table". Restoring applies the migrations first instead.
 *
 * Run with: npm run db:backup
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

/** Enough history to survive a bad import going unnoticed for a few days. */
const KEEP = 10;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "backups");
mkdirSync(dir, { recursive: true });

// Colons are not legal in Windows filenames, so the ISO timestamp is flattened
// rather than used as-is. Sorting stays chronological either way.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const output = join(dir, `semester-os-${stamp}.sql`);

// Wrangler's JS entrypoint is run directly rather than through npx: Node
// refuses to spawn .cmd shims without a shell, and going through a shell would
// mean quoting a path that can contain spaces.
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

execFileSync(
  process.execPath,
  [
    wrangler,
    "d1",
    "export",
    "semester-os",
    "--local",
    "--no-schema",
    "--output",
    output,
    "--skip-confirmation",
  ],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);

// Rewritten with two changes. The pragma has to be inside the file because it
// applies to the transaction wrangler opens around it, and without it the
// inserts fail: tables reference each other, so no ordering satisfies every
// constraint row by row. The d1_migrations rows are dropped because restoring
// applies the migrations itself and would otherwise collide with them.
const inserts = readFileSync(output, "utf8")
  .split("\n")
  .filter((line) => line.startsWith("INSERT INTO"))
  .filter((line) => !line.includes('"d1_migrations"'));

writeFileSync(
  output,
  ["PRAGMA defer_foreign_keys=TRUE;", ...inserts, ""].join("\n"),
);

const size = statSync(output).size;
console.log(
  `Backed up to backups/${basename(output)} -- ${inserts.length} rows, ${(size / 1024).toFixed(1)} kB`,
);

// Prune oldest first. Names are timestamped, so lexical order is chronological.
const existing = readdirSync(dir)
  .filter((f) => f.startsWith("semester-os-") && f.endsWith(".sql"))
  .sort();

for (const stale of existing.slice(0, Math.max(0, existing.length - KEEP))) {
  rmSync(join(dir, stale));
  console.log(`Removed old backup ${stale}`);
}

console.log(
  `${Math.min(existing.length, KEEP)} backup(s) kept. Restore with: npm run db:restore -- backups/<file>.sql`,
);
