/**
 * GET /api/ably-token?code=XXXX
 * Cloudflare Pages Function — ออก Ably token เฉพาะ request ที่ผ่าน 2 การตรวจสอบ
 *
 * Environment Variables (Cloudflare Pages → Settings → Environment Variables):
 *   ABLY_API_KEY   = root:xxxxxxxxxxxxxxxx
 *   ROOM_CODE      = รหัสกะ เช่น "PRH-2026" เปลี่ยนได้ทุกกะ
 *   QR_TOKENS      = PRH_ER_2025,PRH_WD_2025,PRH_CT_2025,PRH_LB_2025  (คั่นด้วย ,)
 *   ALLOWED_ORIGIN = https://stroke-activate.pages.dev
 */
export async function onRequest(context) {
  const { request, env } = context;

  // ── Layer 1: Origin / Referer check ──────────────────────────────
  const origin   = request.headers.get('Origin')  || '';
  const referer  = request.headers.get('Referer') || '';
  const allowed  = env.ALLOWED_ORIGIN || '';

  const originOk = !allowed
    || origin.startsWith(allowed)
    || referer.startsWith(allowed);

  if (!originOk) {
    return respond(403, { error: 'Forbidden: invalid origin' });
  }

  // ── Layer 2: Shift code / QR token check ─────────────────────────
  const url      = new URL(request.url);
  const sentCode = url.searchParams.get('code') || '';
  const clientId = url.searchParams.get('clientId') || '';
  const roomCode = env.ROOM_CODE || '';

  // QR_TOKENS = comma-separated list ของ token ที่ฝังใน QR Code
  const qrTokens = (env.QR_TOKENS || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  const isValid = !roomCode                     // dev mode (ไม่ตั้ง env)
    || sentCode === roomCode                    // รหัสกะปกติ
    || qrTokens.includes(sentCode);            // QR token

  if (!isValid) {
    await new Promise(r => setTimeout(r, 600)); // ชะลอ brute force
    return respond(401, { error: 'Invalid shift code' });
  }

  // ── Issue Ably TokenRequest (signed) ─────────────────────────────
  const apiKey  = env.ABLY_API_KEY;
  if (!apiKey) return respond(500, { error: 'ABLY_API_KEY not configured' });

  if (!allowed && url.searchParams.get('debug') === '1') {
    const s = String(apiKey);
    return respond(200, {
      debug: {
        typeof: typeof apiKey,
        length: s.length,
        hasColon: s.includes(':'),
        prefix: s.slice(0, 8),
        suffix: s.slice(-6),
      },
    });
  }

  const apiKeyTrimmed = String(apiKey).trim();
  const colonIdx = apiKeyTrimmed.indexOf(':');
  const keyName = colonIdx >= 0 ? apiKeyTrimmed.slice(0, colonIdx) : '';
  const keySecret = colonIdx >= 0 ? apiKeyTrimmed.slice(colonIdx + 1) : '';
  if (!keyName || !keySecret) return respond(500, { error: 'ABLY_API_KEY invalid format' });

  const ttl = 3_600_000;
  const capabilityObj = { 'stroke-fast-track': ['publish', 'subscribe', 'history'] };
  const capability = canonicalCapability(capabilityObj);
  const timestamp = Date.now();
  const nonce = randomNonce(24);

  const tokenRequest = {
    keyName,
    ttl,
    capability,
    clientId: clientId || undefined,
    timestamp,
    nonce,
  };

  const mac = await signTokenRequestMac(tokenRequest, keySecret);
  return respond(200, { ...tokenRequest, mac });
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

function canonicalCapability(obj) {
  const sorted = {};
  for (const channel of Object.keys(obj).sort()) {
    const ops = Array.isArray(obj[channel]) ? obj[channel].slice().sort() : [];
    sorted[channel] = ops;
  }
  return JSON.stringify(sorted);
}

function randomNonce(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function signTokenRequestMac(tokenRequest, keySecret) {
  const canonical =
    String(tokenRequest.keyName ?? '') + '\n' +
    String(tokenRequest.ttl ?? '') + '\n' +
    String(tokenRequest.capability ?? '') + '\n' +
    String(tokenRequest.clientId ?? '') + '\n' +
    String(tokenRequest.timestamp ?? '') + '\n' +
    String(tokenRequest.nonce ?? '') + '\n';

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(canonical));
  return base64FromArrayBuffer(sig);
}

function base64FromArrayBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
