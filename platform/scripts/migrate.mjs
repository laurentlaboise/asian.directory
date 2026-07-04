// Minimal forward-only migration runner. Applies db/migrations/*.sql in filename order,
// tracking applied files in a _migrations table. Idempotent across runs.
// Usage: DATABASE_URL=... node scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(
  `create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`,
);

const applied = new Set(
  (await client.query("select name from _migrations")).rows.map((r) => r.name),
);

// Optional filename args restrict which migrations run (e.g. only 0001 before auth:migrate).
// With no args, all pending migrations are applied in filename order.
const only = process.argv.slice(2);
let files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (only.length) files = files.filter((f) => only.includes(f));

for (const file of files) {
  if (applied.has(file)) continue;
  console.log(`Applying ${file} …`);
  const sql = readFileSync(join(dir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migrations(name) values ($1)", [file]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    console.error(`Failed on ${file}:`, err.message);
    process.exit(1);
  }
}

console.log("Migrations up to date.");
await client.end();
