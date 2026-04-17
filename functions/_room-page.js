/**
 * Shared helper — serve index.html with a preset room injected.
 * Called by /er, /ward, /ct, /lab functions.
 */
export async function serveRoom(context, room) {
  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/';

  const response = await context.env.ASSETS.fetch(
    new Request(assetUrl.toString(), { headers: context.request.headers })
  );

  const html = await response.text();

  // inject preset before </head> so it is available at parse time
  const injected = html.replace(
    '</head>',
    `<script>window.__PRESET_ROOM__=${JSON.stringify(room)};</script></head>`
  );

  return new Response(injected, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}
