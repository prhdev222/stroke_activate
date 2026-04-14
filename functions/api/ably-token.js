/**
 * GET /api/ably-token?code=XXXX
 * Cloudflare Pages Function — ออก Ably token เฉพาะ request ที่ผ่าน 2 การตรวจสอบ
 *
 * Environment Variables (Cloudflare Pages → Settings → Environment Variables):
 *   ABLY_API_KEY   = root:xxxxxxxxxxxxxxxx
 *   ROOM_CODE      = รหัสกะ เช่น "PRH-2026" เปลี่ยนได้ทุกกะ
 *   ALLOWED_ORIGIN = https://stroke-prh.pages.dev (โดเมนของโรงพยาบาล)
 */
export async function onRequest(context) {
  const { request, env } = context;

  // ── Layer 1: Origin / Referer check ──────────────────────────────
  // ป้องกันคนนอกโดเมนขอ token
  const origin   = request.headers.get('Origin')  || '';
  const referer  = request.headers.get('Referer') || '';
  const allowed  = env.ALLOWED_ORIGIN || '';

  const originOk = !allowed                          // ถ้าไม่ตั้ง env ให้ผ่าน (dev mode)
    || origin.startsWith(allowed)
    || referer.startsWith(allowed);

  if (!originOk) {
    return respond(403, { error: 'Forbidden: invalid origin' });
  }

  // ── Layer 2: Shift code check ────────────────────────────────────
  // staff ต้องส่ง code ถูกต้อง ถึงจะได้ token
  const url      = new URL(request.url);
  const sentCode = url.searchParams.get('code') || '';
  const roomCode = env.ROOM_CODE || '';

  if (roomCode && sentCode !== roomCode) {
    // delay เล็กน้อยเพื่อชะลอ brute force
    await new Promise(r => setTimeout(r, 600));
    return respond(401, { error: 'Invalid shift code' });
  }

  // ── Issue Ably token ─────────────────────────────────────────────
  const apiKey  = env.ABLY_API_KEY;
  if (!apiKey) return respond(500, { error: 'ABLY_API_KEY not configured' });

  const [keyName] = apiKey.split(':');
  const res = await fetch(`https://rest.ably.io/keys/${keyName}/requestToken`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      capability: { 'stroke-fast-track': ['publish', 'subscribe'] },
      ttl: 3_600_000,   // 1 ชั่วโมง — SDK renew อัตโนมัติ
    }),
  });

  const token = await res.json();
  return respond(res.status, token);
}

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
