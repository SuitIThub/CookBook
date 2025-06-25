import type { APIRoute } from 'astro';
import { db } from '../../../lib/database';
import { eventBus, EVENTS } from '../../../lib/events';

// Store active connections
const connections = new Map<string, ReadableStreamDefaultController>();

// Setup event listeners once
let eventListenersSetup = false;

function setupEventListeners() {
  if (eventListenersSetup) return;
  eventListenersSetup = true;

  // Listen for shopping list updates
  eventBus.on(EVENTS.SHOPPING_LIST_UPDATED, (data) => {
    broadcastShoppingListUpdate(data.listId, data.list);
  });

  // Listen for shopping list creation
  eventBus.on(EVENTS.SHOPPING_LIST_CREATED, (data) => {
    broadcastAllShoppingLists({ type: 'created', list: data.list });
  });

  // Listen for shopping list deletion
  eventBus.on(EVENTS.SHOPPING_LIST_DELETED, (data) => {
    broadcastAllShoppingLists({ type: 'deleted', listId: data.listId });
  });
}

export const GET: APIRoute = async ({ url }) => {
  // Setup event listeners
  setupEventListeners();
  
  const searchParams = new URL(url).searchParams;
  const listId = searchParams.get('listId');
  
  if (!listId) {
    return new Response('Missing listId parameter', { status: 400 });
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Store this connection
      const connectionId = `${listId}-${Date.now()}-${Math.random()}`;
      connections.set(connectionId, controller);
      
      // Send initial connection confirmation
      const data = `data: ${JSON.stringify({ type: 'connected', listId })}\n\n`;
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

// Function to broadcast updates to all connected clients for a specific shopping list
export function broadcastShoppingListUpdate(listId: string, updateData: any) {
  const message = `data: ${JSON.stringify({
    type: 'update',
    listId,
    data: updateData,
    timestamp: new Date().toISOString()
  })}\n\n`;
  
  const encodedMessage = new TextEncoder().encode(message);
  
  // Send to all connections for this shopping list
  for (const [connectionId, controller] of connections.entries()) {
    if (connectionId.startsWith(`${listId}-`) || connectionId.startsWith('all-')) {
      try {
        controller.enqueue(encodedMessage);
      } catch (error) {
        // Connection is probably closed, remove it
        connections.delete(connectionId);
      }
    }
  }
}

// Function to broadcast to all shopping lists (for list creation/deletion)
export function broadcastAllShoppingLists(updateData: any) {
  const message = `data: ${JSON.stringify({
    type: 'lists-update',
    data: updateData,
    timestamp: new Date().toISOString()
  })}\n\n`;
  
  const encodedMessage = new TextEncoder().encode(message);
  
  // Send to all connections
  for (const [connectionId, controller] of connections.entries()) {
    try {
      controller.enqueue(encodedMessage);
    } catch (error) {
      // Connection is probably closed, remove it
      connections.delete(connectionId);
    }
  }
} 