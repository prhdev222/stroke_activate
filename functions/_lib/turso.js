import { createClient } from '@libsql/client';

let _client = null;
let _initPromise = null;

export function getTursoClient(env) {
  const url = env?.TURSO_DATABASE_URL;
  const authToken = env?.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error('Turso env not configured (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)');
  }
  if (_client) return _client;
  _client = createClient({ url, authToken });
  return _client;
}

export async function getTursoClientReady(env) {
  const client = getTursoClient(env);
  if (!_initPromise) _initPromise = ensureSchema(client);
  await _initPromise;
  return client;
}

async function ensureSchema(client) {
  // ทำครั้งเดียวต่อ instance (ใช้ IF NOT EXISTS เพื่อไม่เปลืองและไม่พังซ้ำ)
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
}

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    },
  });
}

export async function readJson(request, maxBytes = 16_384) {
  const len = Number(request.headers.get('content-length') || '0');
  if (len && len > maxBytes) throw new Error('Payload too large');
  return await request.json();
}

export function originOk(request, env) {
  const allowed = env?.ALLOWED_ORIGIN || '';
  if (!allowed) return true; // dev mode
  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';
  return origin.startsWith(allowed) || referer.startsWith(allowed);
}

export async function verifyRoomCode(sentCode, env) {
  const roomCode = env?.ROOM_CODE || '';
  if (!roomCode) return true;
  if (sentCode !== roomCode) {
    await new Promise(r => setTimeout(r, 600));
    return false;
  }
  return true;
}

