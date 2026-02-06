import type { APIRoute } from 'astro';

// Handle POST requests from Web Share Target (Level 2)
export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    const formData = await request.formData();
    const sharedUrl = (formData.get('url') || formData.get('text') || formData.get('title')) as string | null;

    if (!sharedUrl) {
      return redirect('/rezepte', 302);
    }

    const target = `/rezepte?importUrl=${encodeURIComponent(sharedUrl)}`;
    return redirect(target, 302);
  } catch (error) {
    console.error('Error handling share target POST:', error);
    return redirect('/rezepte', 302);
  }
};

// Fallback for GET (in case some browsers still use query params)
export const GET: APIRoute = async ({ url, redirect }) => {
  const sharedUrl = url.searchParams.get('url');

  if (!sharedUrl) {
    return redirect('/rezepte', 302);
  }

  const target = `/rezepte?importUrl=${encodeURIComponent(sharedUrl)}`;
  return redirect(target, 302);
};

