import { serveRoom } from './_room-page.js';
export const onRequest = (ctx) => serveRoom(ctx, 'CT');
