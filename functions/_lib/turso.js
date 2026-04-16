// Turso HTTP API — zero npm dependencies, works in Cloudflare Pages Functions

let _initDone = false;

function tursoBase(env) {
  const raw = env?.TURSO_DATABASE_URL || '';
  // libsql://xxx.turso.io  ->  https://xxx.turso.io
  return raw.replace(/^libsql:\/\//, 'https://');
}

function tursoToken(env) {
  return env?.TURSO_AUTH_TOKEN || '';
}

// Execute one or more SQL statements via Turso HTTP pipeline API
// stmts = [{ sql, args: [{type,value},...] }, ...]
async function pipeline(env, stmts) {
  const base  = tursoBase(env);
  const token = tursoToken(env);
  if (!base || !token) throw new Error('Turso env not configured (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)');

  const requests = stmts.map(s => ({ type: 'execute', stmt: s }));
  requests.push({ type: 'close' });

  const res = await fetch(`${base}/v2/pipeline`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => res.status);
    throw new Error(`Turso HTTP ${res.status}: ${txt}`);
  }
  return await res.json();
}

// Encode JS value -> Turso typed arg
function arg(v) {
  if (v == null) return { type: 'null' };
  if (typeof v === 'number') return { type: 'integer', value: String(Math.round(v)) };
  return { type: 'text', value: String(v) };
}

// ─── Schema bootstrap (once per cold start) ────────────────────────────────
let _initPromise = null;

export async function getTursoClientReady(env) {
  if (!_initPromise) _initPromise = ensureSchema(env);
  await _initPromise;
  return { execute: (sql, args) => pipeline(env, [{ sql, args: (args||[]).map(arg) }]) };
}

async function ensureSchema(env) {
  await pipeline(env, [
    { sql: `CREATE TABLE IF NOT EXISTS cases (
              case_id    TEXT PRIMARY KEY,
              start_ts   INTEGER NOT NULL,
              start_loc  TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS events (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              case_id    TEXT NOT NULL,
              action     TEXT NOT NULL,
              ts_ms      INTEGER NOT NULL,
              delta_ms   INTEGER,
              loc        TEXT,
              sender     TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_events_case_ts ON events(case_id, ts_ms)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS delays (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              case_id      TEXT NOT NULL,
              metric       TEXT NOT NULL,
              value_ms     INTEGER NOT NULL,
              target_ms    INTEGER,
              reasons_json TEXT NOT NULL,
              note         TEXT,
              created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_delays_case_metric ON delays(case_id, metric)`, args: [] },
  ]);
}

// ─── Helpers ───────────────────────────────────────────────────────────────
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
  if (!allowed) return true;
  const origin  = request.headers.get('Origin')  || '';
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
