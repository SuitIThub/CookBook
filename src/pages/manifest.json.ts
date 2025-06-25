import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';

interface RelatedApplication {
  platform: string;
  id: string;
}

interface WebManifest {
  permissions?: string[];
  related_applications?: RelatedApplication[];
  [key: string]: any;
}

export const ALL: APIRoute = async ({ request }) => {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  try {
    const manifestPath = path.join(process.cwd(), 'public', 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as WebManifest;
    
    // Ensure Cast-related permissions are present
    if (!manifest.permissions) {
      manifest.permissions = [];
    }
    if (!manifest.permissions.includes('https://www.gstatic.com/')) {
      manifest.permissions.push('https://www.gstatic.com/');
    }
    if (!manifest.permissions.includes('https://www.googleapis.com/')) {
      manifest.permissions.push('https://www.googleapis.com/');
    }

    // Ensure Cast-related application info is present
    if (!manifest.related_applications) {
      manifest.related_applications = [];
    }
    if (!manifest.related_applications.some((app: RelatedApplication) => app.platform === 'chrome_cast')) {
      manifest.related_applications.push({
        platform: 'chrome_cast',
        id: '3D0A6542'
      });
    }
    
    return new Response(JSON.stringify(manifest, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error('Error serving manifest.json:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to serve manifest.json',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
}; 