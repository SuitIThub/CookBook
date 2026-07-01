import type { APIRoute } from 'astro';
import { eventBus, EVENTS } from '../../../lib/events';

// Store active connections together with the alias they subscribed to.
const connections = new Map<
  string,
  { controller: ReadableStreamDefaultController; alias: string }
>();

let eventListenersSetup = false;

function setupEventListeners() {
  if (eventListenersSetup) return;
  eventListenersSetup = true;

  eventBus.on(EVENTS.ALIAS_SETTINGS_UPDATED, (data) => {
    broadcast(data.alias, {
      type: 'update',
      setting: { key: data.key, value: data.value, updatedAt: data.updatedAt },
    });
  });
}

function broadcast(alias: string, payload: any) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  const encoded = new TextEncoder().encode(message);
  const closed: string[] = [];

  for (const [connectionId, conn] of connections.entries()) {
    if (conn.alias !== alias) continue;
    try {
      conn.controller.enqueue(encoded);
    } catch (error) {
      closed.push(connectionId);
    }
  }

  closed.forEach((id) => connections.delete(id));
}

export const GET: APIRoute = async ({ request }) => {
  setupEventListeners();

  const url = new URL(request.url);
  const alias = (url.searchParams.get('alias') || '').trim().slice(0, 128);

  if (!alias) {
    return new Response(JSON.stringify({ error: 'Alias is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const connectionId = `alias-${Date.now()}-${Math.random()}`;
      connections.set(connectionId, { controller, alias });

      const data = `data: ${JSON.stringify({ type: 'connected' })}\n\n`;
      controller.enqueue(new TextEncoder().encode(data));

      (controller as any)._cleanup = () => {
        connections.delete(connectionId);
      };
    },

    cancel() {
      if ((this as any)._cleanup) {
        (this as any)._cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
};
