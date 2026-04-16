import { getTursoClientReady, json, readJson, originOk, verifyRoomCode } from '../_lib/turso.js';

const ALLOWED_ACTIONS = new Set([
  'activate', 'ct', 'lab', 'ct_result', 'lab_result',
  'decision', 'admit', 'refer', 'milestone',
]);

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!originOk(request, env)) return json(403, { error: 'Forbidden: invalid origin' });

    let body;
    try { body = await readJson(request); } catch { return json(400, { error: 'Invalid JSON' }); }

    const ok = await verifyRoomCode(String(body?.code || ''), env);
    if (!ok) return json(401, { error: 'Invalid shift code' });

    const action  = String(body?.action  || '');
    if (!ALLOWED_ACTIONS.has(action)) return json(400, { error: 'Invalid action' });

    const caseId  = String(body?.caseId  || '');
    const startTs = Number(body?.startTs);
    const tsMs    = Number(body?.tsMs);
    const deltaMs = body?.deltaMs == null ? null : Number(body.deltaMs);
    const loc     = body?.loc  == null ? null : String(body.loc).slice(0, 12);
    const from    = body?.from == null ? null : String(body.from).slice(0, 12);

    if (!caseId || !Number.isFinite(startTs) || !Number.isFinite(tsMs))
      return json(400, { error: 'Missing caseId/startTs/tsMs' });

    const client = await getTursoClientReady(env);

    await client.execute(
      `INSERT INTO cases (case_id, start_ts, start_loc) VALUES (?, ?, ?)
       ON CONFLICT(case_id) DO NOTHING`,
      [caseId, startTs, loc]
    );

    await client.execute(
      `INSERT INTO events (case_id, action, ts_ms, delta_ms, loc, sender) VALUES (?, ?, ?, ?, ?, ?)`,
      [caseId, action, tsMs, deltaMs, loc, from]
    );

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: 'Internal error', detail: String(e?.message || e) });
  }
}
