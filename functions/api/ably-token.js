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
  const clientId = url.searchParams.get('clientId') || '';
  const roomCode = env.ROOM_CODE || '';

  if (roomCode && sentCode !== roomCode) {
    // delay เล็กน้อยเพื่อชะลอ brute force
    await new Promise(r => setTimeout(r, 600));
    return respond(401, { error: 'Invalid shift code' });
  }

  // ── Issue Ably TokenRequest (signed) ─────────────────────────────
  // สำหรับ Ably JS SDK (authUrl) แนวทางที่เสถียรคือให้ server สร้าง TokenRequest + mac
  // แล้ว SDK จะนำไปแลก token เอง (ไม่ต้องเรียก requestToken REST จาก server)
  const apiKey  = env.ABLY_API_KEY;
  if (!apiKey) return respond(500, { error: 'ABLY_API_KEY not configured' });

  const [keyName, keySecret] = apiKey.split(':');
  if (!keyName || !keySecret) return respond(500, { error: 'ABLY_API_KEY invalid format' });

  const ttl = 3_600_000; // 1 ชั่วโมง
  const capabilityObj = { 'stroke-fast-track': ['publish', 'subscribe'] };
  const capability = canonicalCapability(capabilityObj);
  const timestamp = Date.now(); // ms since epoch (number)
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
  // สเปก Ably แนะนำให้ capability เป็น JSON string ที่ deterministic (เรียง key/values)
  // เพื่อให้ sign แล้วฝั่ง Ably ตรวจได้ตรงกัน
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
  // base64url-ish แบบง่าย (A-Z a-z 0-9) เพื่อให้เป็น string ปลอดภัย
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function signTokenRequestMac(tokenRequest, keySecret) {
  // TokenRequest canonical string (Ably spec):
  // keyName\nttl\ncapability\nclientId\ntimestamp\nnonce\n
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
  // chunk เพื่อไม่ให้ stack/arg ยาวเกิน
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
