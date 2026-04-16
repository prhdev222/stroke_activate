import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';

function parseDevVars(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    out[k] = v;
  }
  return out;
}

function req(name, env) {
  const v = env[name] || process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const devVars = parseDevVars(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'));
  const url = req('TURSO_DATABASE_URL', devVars);
  const authToken = req('TURSO_AUTH_TOKEN', devVars);

  const client = createClient({ url, authToken });

  await client.execute(`PRAGMA foreign_keys = ON;`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS cases (
      case_id   TEXT PRIMARY KEY,
      start_ts  INTEGER NOT NULL,
      start_loc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id  TEXT NOT NULL,
      action   TEXT NOT NULL,
      ts_ms    INTEGER NOT NULL,
      delta_ms INTEGER,
      loc      TEXT,
      sender   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_events_case_ts ON events(case_id, ts_ms);`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS delays (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id   TEXT NOT NULL,
      metric    TEXT NOT NULL,
      value_ms  INTEGER NOT NULL,
      target_ms INTEGER,
      reasons_json TEXT NOT NULL,
      note      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_delays_case_metric ON delays(case_id, metric);`);

  const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`);
  // Print only table names (no secrets)
  console.log('OK. Tables:');
  for (const r of tables.rows) console.log('-', r.name);
}

main().catch(err => {
  console.error('Init Turso failed:', err?.message || err);
  process.exitCode = 1;
});

