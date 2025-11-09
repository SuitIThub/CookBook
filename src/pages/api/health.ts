import type { APIRoute } from 'astro';
import { db } from '../../lib/database';

/**
 * Health check endpoint
 * 
 * Returns the health status of the application including database connectivity.
 * 
 * Returns:
 * - 200: Application is healthy
 * - 503: Application is unhealthy (database connection failed)
 */
export const GET: APIRoute = async () => {
  try {
    // Check database connectivity
    const healthCheck = db.healthCheck();
    
    if (!healthCheck.healthy) {
      return new Response(JSON.stringify({
        status: 'unhealthy',
        database: 'disconnected',
        error: healthCheck.error,
        timestamp: new Date().toISOString()
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get basic statistics
    const stats = db.getStats();

    return new Response(JSON.stringify({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      stats: {
        recipes: stats.recipes,
        shoppingLists: stats.shoppingLists
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Health check failed:', error);
    return new Response(JSON.stringify({
      status: 'unhealthy',
      database: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

