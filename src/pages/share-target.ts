import type { APIRoute } from 'astro';

function isHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function pickSharedUrl(values: Array<string | null | undefined>): string | null {
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;

    if (isHttpUrl(value)) {
      return value;
    }

    const inlineUrlMatch = value.match(/https?:\/\/[^\s<>"'`]+/i);
    if (inlineUrlMatch && isHttpUrl(inlineUrlMatch[0])) {
      return inlineUrlMatch[0];
    }
  }

  return null;
}

// Handle POST requests from Web Share Target (Level 2)
export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    const formData = await request.formData();
    const sharedUrl = pickSharedUrl([
      formData.get('url') as string | null,
      formData.get('text') as string | null,
      formData.get('title') as string | null
    ]);

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
  const sharedUrl = pickSharedUrl([
    url.searchParams.get('url'),
    url.searchParams.get('text'),
    url.searchParams.get('title')
  ]);

  if (!sharedUrl) {
    return redirect('/rezepte', 302);
  }

  const target = `/rezepte?importUrl=${encodeURIComponent(sharedUrl)}`;
  return redirect(target, 302);
};

