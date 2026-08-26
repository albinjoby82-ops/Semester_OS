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
 * Restoring the deployed database is a further step again, and deliberately
 * awkward. It overwrites data that exists on a live site and is not sitting on
 * this machine to be recovered from, so it demands --yes rather than assuming
 * that typing the command was the same as meaning it. Restoring a snapshot
 * taken from the other environment demands --force on top: reviving local
 * scratch data over a live database is the specific accident worth making
 * hard, and it is not one a confirmation prompt alone would catch.
 *
 * Stop the dev server first when restoring locally. Miniflare holds the local
 * database open and the restore fails partway through with a JSON parse error
 * that says nothing about the actual cause.
 *
 * Run with: npm run db:restore -- backups/local/<file>.sql
 *           npm run db:restore:remote -- backups/remote/<file>.sql --yes
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const confirmed = args.includes("--yes");
const forced = args.includes("--force");
const env = remote ? "remote" : "local";

const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error(
    `Usage: npm run db:restore${remote ? ":remote" : ""} -- backups/${env}/<file>.sql${remote ? " --yes" : ""}`,
  );
  process.exit(1);
}

if (remote && !confirmed) {
  console.error(
    "Refusing to restore the deployed database without --yes.\n" +
      "This overwrites live data that does not exist on this machine.",
  );
  process.exit(1);
}

const file = resolve(root, target);
if (!existsSync(file)) {
  console.error(`No such backup: ${target}`);
  process.exit(1);
}

// The environment is in the filename, so a snapshot cannot be mistaken for
// one taken somewhere else once it has been moved or renamed.
if (!basename(file).startsWith(`semester-os-${env}-`) && !forced) {
  console.error(
    `${basename(file)} was not taken from the ${env} database.\n` +
      "Restoring one environment's data into the other is almost never what\n" +
      "you want. Pass --force if it genuinely is.",
  );
  process.exit(1);
}

const scope = remote ? "--remote" : "--local";

const d1 = (d1Args, capture = false) =>
  execFileSync(process.execPath, [wrangler, "d1", ...d1Args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : ["ignore", "ignore", "inherit"],
  });

console.log(`Snapshotting current ${env} state before restoring...`);
execFileSync(
  process.execPath,
  [join(root, "scripts", "backup.mjs"), ...(remote ? ["--remote"] : [])],
  { cwd: root, stdio: "inherit" },
);

// Internal D1 bookkeeping (_cf_*) is left alone; dropping it breaks the
// database rather than clearing it.
const listed = d1(
  [
    "execute",
    "semester-os",
    scope,
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
  d1(["execute", "semester-os", scope, "--command", drops]);
}

// Schema comes from the migrations, not the snapshot: they are the
// authoritative copy and the only one that applies in a valid order.
console.log("Recreating schema from migrations...");
d1(["migrations", "apply", "semester-os", scope]);

console.log(`Restoring data from ${target}...`);
d1(["execute", "semester-os", scope, "--file", file]);

const counts = d1(
  [
    "execute",
    "semester-os",
    scope,
    "--json",
    "--command",
    "SELECT (SELECT COUNT(*) FROM modules) modules, (SELECT COUNT(*) FROM assignments) assignments, (SELECT COUNT(*) FROM grades) grades, (SELECT COUNT(*) FROM time_sessions) sessions, (SELECT COUNT(*) FROM calendar_events) events",
  ],
  true,
);

const row = JSON.parse(counts)[0]?.results?.[0] ?? {};
console.log(
  `Restored ${env}. modules=${row.modules} assignments=${row.assignments} grades=${row.grades} sessions=${row.sessions} events=${row.events}`,
);
