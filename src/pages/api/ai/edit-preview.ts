import type { APIRoute } from 'astro';
import { getAiEditPreviewToken } from '../../../lib/aiRecipeEditPreviewStore';

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response(JSON.stringify({ error: 'token required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const data = getAiEditPreviewToken(token);
  if (!data) {
    return new Response(JSON.stringify({ error: 'preview not found or expired' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
