/**
 * Stop an otherwise successful deploy from shipping the committed local D1
 * placeholder. Wrangler reports the real binding problem only after upload;
 * this gives the owner a direct, actionable error first.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(root, "wrangler.jsonc"), "utf8");
const match = config.match(/"database_id"\s*:\s*"([^"]+)"/);
const databaseId = match?.[1];

if (!databaseId || databaseId === "local-dev-placeholder") {
  console.error(
    "Deploy blocked: create the production D1 database, then replace the database_id placeholder in wrangler.jsonc. See DEPLOYMENT.md.",
  );
  process.exit(1);
}

console.log(`Deployment configuration valid (D1: ${databaseId}).`);
