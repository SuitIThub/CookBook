import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, redirect }) => {
  const sharedUrl = url.searchParams.get('url');

  // If no URL was provided, just go to the recipes list
  if (!sharedUrl) {
    return redirect('/rezepte', 302);
  }

  // Redirect to recipes page and pass the shared URL so the import modal can use it
  const target = `/rezepte?importUrl=${encodeURIComponent(sharedUrl)}`;
  return redirect(target, 302);
};

