import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';

/**
 * Lean "something changed" stream for sync clients (the app). Emits the
 * change-log high-water mark (`{ seq }`) whenever it grows, so a client can pull
 * right away instead of waiting for its next periodic sync — e.g. a roommate
 * ticking items off the shared shopping list shows up within ~2 s.
 *
 * Unlike /api/shopping-lists/stream it never sends row data (lists can be
 * multi-MB). One shared poller checks the change log for all connections.
 */
const POLL_MS = 2000;
const KEEPALIVE_MS = 25000;

const clients = new Set<ReadableStreamDefaultController>();
let poller: ReturnType<typeof setInterval> | null = null;
let lastSeq = 0;
const encoder = new TextEncoder();

function send(c: ReadableStreamDefaultController, chunk: string): boolean {
  try {
    c.enqueue(encoder.encode(chunk));
    return true;
  } catch {
    clients.delete(c);
    return false;
  }
}

function ensurePoller() {
  if (poller) return;
  lastSeq = db.getMaxSyncSeq();
  let sinceKeepalive = 0;
  poller = setInterval(() => {
    if (clients.size === 0) {
      clearInterval(poller!);
      poller = null;
      return;
    }
    const seq = db.getMaxSyncSeq();
    sinceKeepalive += POLL_MS;
    if (seq !== lastSeq) {
      lastSeq = seq;
      for (const c of [...clients]) send(c, `data: ${JSON.stringify({ seq })}\n\n`);
    } else if (sinceKeepalive >= KEEPALIVE_MS) {
      sinceKeepalive = 0;
      for (const c of [...clients]) send(c, `: keepalive\n\n`);
    }
  }, POLL_MS);
}

export const GET: APIRoute = async ({ request }) => {
  let ctrl: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(controller) {
      ctrl = controller;
      clients.add(controller);
      ensurePoller();
      send(controller, `data: ${JSON.stringify({ seq: db.getMaxSyncSeq() })}\n\n`);
    },
    cancel() {
      clients.delete(ctrl);
    }
  });
  request.signal?.addEventListener('abort', () => clients.delete(ctrl));

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
