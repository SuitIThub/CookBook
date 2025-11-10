import type { APIRoute } from 'astro';
import { eventBus, EVENTS } from '../../../lib/events';

// Store active connections
const connections = new Map<string, ReadableStreamDefaultController>();

// Setup event listeners once
let eventListenersSetup = false;

function setupEventListeners() {
  if (eventListenersSetup) return;
  eventListenersSetup = true;

  // Listen for global timer events
  eventBus.on(EVENTS.GLOBAL_TIMER_CREATED, (data) => {
    broadcastTimerUpdate({ type: 'created', timer: data.timer });
  });

  eventBus.on(EVENTS.GLOBAL_TIMER_UPDATED, (data) => {
    broadcastTimerUpdate({ type: 'updated', timerId: data.timerId, updates: data.updates });
  });

  eventBus.on(EVENTS.GLOBAL_TIMER_DELETED, (data) => {
    broadcastTimerUpdate({ type: 'deleted', timerId: data.timerId });
  });
}

function broadcastTimerUpdate(data: any) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encodedMessage = encoder.encode(message);
  
  // Use for...of to safely iterate and remove closed connections
  const closedConnections: string[] = [];
  
  for (const [connectionId, controller] of connections.entries()) {
    try {
      controller.enqueue(encodedMessage);
    } catch (error) {
      // Connection is probably closed, mark for removal
      closedConnections.push(connectionId);
    }
  }
  
  // Remove closed connections
  closedConnections.forEach(id => connections.delete(id));
}

export const GET: APIRoute = async () => {
  // Setup event listeners
  setupEventListeners();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Store this connection
      const connectionId = `timer-${Date.now()}-${Math.random()}`;
      connections.set(connectionId, controller);
      
      // Send initial connection confirmation
      const data = `data: ${JSON.stringify({ type: 'connected' })}\n\n`;
      controller.enqueue(new TextEncoder().encode(data));
      
      // Clean up connection when closed
      const cleanup = () => {
        connections.delete(connectionId);
      };
      
      // Store cleanup function for later use
      (controller as any)._cleanup = cleanup;
    },
    
    cancel() {
      // Connection closed by client
      if ((this as any)._cleanup) {
        (this as any)._cleanup();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    }
  });
};

