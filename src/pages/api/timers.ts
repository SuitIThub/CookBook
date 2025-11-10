import type { APIRoute } from 'astro';
import { db } from '../../lib/database';
import { v4 as uuidv4 } from 'uuid';

// GET all active global timers
export const GET: APIRoute = async () => {
  try {
    const timers = db.getAllGlobalTimers();
    return new Response(JSON.stringify(timers), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching global timers:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch timers' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST create a new global timer
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const {
      label,
      duration,
      remaining,
      isRunning = false,
      isCompleted = false,
      recipeName,
      stepDescription,
      recipeId,
      stepId,
      startTime,
      pauseTime
    } = body;

    if (!label || duration === undefined || remaining === undefined) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const timerId = body.id || uuidv4();
    
    db.createGlobalTimer({
      id: timerId,
      label,
      duration,
      remaining,
      isRunning,
      isCompleted,
      recipeName,
      stepDescription,
      recipeId,
      stepId,
      startTime,
      pauseTime
    });

    const timer = db.getGlobalTimer(timerId);
    return new Response(JSON.stringify(timer), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating global timer:', error);
    return new Response(JSON.stringify({ error: 'Failed to create timer' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// PUT update a global timer
export const PUT: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: 'Timer ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get current timer state
    const timer = db.getGlobalTimer(id);
    if (!timer) {
      return new Response(JSON.stringify({ error: 'Timer not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle remaining time updates
    if (updates.remaining !== undefined) {
      // If remaining is explicitly provided, use it (for pause/stop/adjust)
      // This is the actual remaining time at this moment
    } else if (updates.isRunning && updates.startTime) {
      // Timer is running - only update remaining if startTime changed (timer was restarted)
      if (timer.startTime !== updates.startTime) {
        // Timer was started/restarted - use current remaining as the base
        updates.remaining = timer.remaining;
      }
      // If startTime didn't change, don't update remaining (let it be calculated from startTime)
    }

    db.updateGlobalTimer(id, updates);
    const updatedTimer = db.getGlobalTimer(id);
    
    if (!updatedTimer) {
      return new Response(JSON.stringify({ error: 'Timer not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(updatedTimer), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating global timer:', error);
    return new Response(JSON.stringify({ error: 'Failed to update timer' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// DELETE a global timer
export const DELETE: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: 'Timer ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    db.deleteGlobalTimer(id);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting global timer:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete timer' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

