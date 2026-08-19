import type { APIRoute } from 'astro';
import { deleteLocalProductImage, isLocalProductImageUrl, saveProductImageFile } from '../../../lib/productImages';

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('image');

    if (!(file instanceof File) || file.size === 0) {
      return json({ error: 'File is required' }, 400);
    }

    const saved = await saveProductImageFile(file);
    return json(saved, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.startsWith('Invalid file') || message.startsWith('File too large') ? 400 : 500;
    if (status === 500) console.error('Error uploading product image:', error);
    return json({ error: message }, status);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  try {
    const imageUrl = new URL(url).searchParams.get('url');
    if (!imageUrl || !isLocalProductImageUrl(imageUrl)) {
      return json({ error: 'Local product image URL is required' }, 400);
    }
    await deleteLocalProductImage(imageUrl);
    return json({ success: true });
  } catch (error) {
    console.error('Error deleting product image:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
