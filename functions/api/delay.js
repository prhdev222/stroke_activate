import { getTursoClientReady, json, readJson, originOk, verifyRoomCode } from '../_lib/turso.js';

const ALLOWED_METRICS = new Set(['door_to_ct', 'door_to_decision', 'door_to_refer']);

function clampStr(s, max) {
  if (!s) return '';
  return String(s).trim().slice(0, max);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!originOk(request, env)) return json(403, { error: 'Forbidden: invalid origin' });

    let body;
    try {
      body = await readJson(request);
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const ok = await verifyRoomCode(String(body?.code || ''), env);
    if (!ok) return json(401, { error: 'Invalid shift code' });

    const caseId = String(body?.caseId || '');
    const startTs = Number(body?.startTs);
    const loc = body?.loc == null ? null : String(body?.loc).slice(0, 12);
    const metrics = Array.isArray(body?.metrics) ? body.metrics : [];

    if (!caseId || !Number.isFinite(startTs) || metrics.length === 0) {
      return json(400, { error: 'Missing caseId/startTs/metrics' });
    }

    const client = await getTursoClientReady(env);

    await client.execute({
      sql: `INSERT INTO cases (case_id, start_ts, start_loc)
          VALUES (?, ?, ?)
          ON CONFLICT(case_id) DO NOTHING`,
      args: [caseId, startTs, loc || null],
    });

    for (const m of metrics) {
      const metric = String(m?.metric || '');
      if (!ALLOWED_METRICS.has(metric)) continue;

      const valueMs = Number(m?.valueMs);
      const targetMs = m?.targetMs == null ? null : Number(m?.targetMs);
      if (!Number.isFinite(valueMs)) continue;

      const reasons = Array.isArray(m?.reasons) ? m.reasons.map(r => clampStr(r, 48)).filter(Boolean) : [];
      const note = clampStr(m?.note, 120);

      // ประหยัด: เก็บเป็น 1 row ต่อ metric (เหตุผลเป็น JSON string สั้นๆ)
      await client.execute({
        sql: `INSERT INTO delays (case_id, metric, value_ms, target_ms, reasons_json, note)
            VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          caseId,
          metric,
          valueMs,
          targetMs,
          JSON.stringify(reasons),
          note || null,
        ],
      });
    }

    return json(200, { ok: true });
  } catch (e) {
    const msg = e?.message ? String(e.message) : 'Internal error';
    return json(500, { error: 'Internal error', detail: msg });
  }
}

