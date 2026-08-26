/**
 * Restore the local D1 database from a snapshot made by npm run db:backup.
 *
 * Destructive by nature: every existing table is dropped so the snapshot's
 * rows land in a database that cannot conflict with them. To make that
 * survivable the current state is snapshotted before anything is dropped -- a
 * restore aimed at the wrong file is then itself undoable, which matters most
 * in exactly the panicked circumstances where someone reaches for this script.
 *
 * The schema is rebuilt from db/migrations rather than from the snapshot,
 * which holds data only.
 *
 * Run with: npm run db:restore -- backups/<file>.sql
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

const target = process.argv[2];
if (!target) {
  console.error("Usage: npm run db:restore -- backups/<file>.sql");
  process.exit(1);
}

const file = resolve(root, target);
if (!existsSync(file)) {
  console.error(`No such backup: ${target}`);
  process.exit(1);
}

const d1 = (args, capture = false) =>
  execFileSync(process.execPath, [wrangler, "d1", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : ["ignore", "ignore", "inherit"],
  });

console.log("Snapshotting current state before restoring...");
execFileSync(process.execPath, [join(root, "scripts", "backup.mjs")], {
  cwd: root,
  stdio: "inherit",
});

// Internal D1 bookkeeping (_cf_*) is left alone; dropping it breaks the
// database rather than clearing it.
const listed = d1(
  [
    "execute",
    "semester-os",
    "--local",
    "--json",
    "--command",
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ],
  true,
);

const tables = (JSON.parse(listed)[0]?.results ?? []).map((r) => r.name);

if (tables.length > 0) {
  console.log(`Dropping ${tables.length} existing table(s)...`);
  // Foreign keys are deferred for the duration: the tables reference each
  // other, so no drop order is free of violations, and picking one by hand
  // would silently rot the moment a relation is added. The export applies the
  // same pragma for the same reason.
  const drops = [
    "PRAGMA defer_foreign_keys=TRUE;",
    ...tables.map((t) => `DROP TABLE IF EXISTS "${t}";`),
  ].join(" ");
  d1(["execute", "semester-os", "--local", "--command", drops]);
}

// Schema comes from the migrations, not the snapshot: they are the
// authoritative copy and the only one that applies in a valid order.
console.log("Recreating schema from migrations...");
d1(["migrations", "apply", "semester-os", "--local"]);

console.log(`Restoring data from ${target}...`);
d1(["execute", "semester-os", "--local", "--file", file]);

const counts = d1(
  [
    "execute",
    "semester-os",
    "--local",
    "--json",
    "--command",
    "SELECT (SELECT COUNT(*) FROM modules) modules, (SELECT COUNT(*) FROM assignments) assignments, (SELECT COUNT(*) FROM grades) grades, (SELECT COUNT(*) FROM time_sessions) sessions, (SELECT COUNT(*) FROM calendar_events) events",
  ],
  true,
);

const row = JSON.parse(counts)[0]?.results?.[0] ?? {};
console.log(
  `Restored. modules=${row.modules} assignments=${row.assignments} grades=${row.grades} sessions=${row.sessions} events=${row.events}`,
);
