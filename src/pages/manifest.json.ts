import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';

export const GET: APIRoute = async () => {
  try {
    const manifestPath = path.join(process.cwd(), 'public', 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    
    return new Response(manifestContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Error serving manifest.json:', error);
    return new Response(JSON.stringify({ error: 'Failed to serve manifest.json' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 