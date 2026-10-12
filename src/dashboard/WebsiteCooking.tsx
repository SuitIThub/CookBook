/**
 * Website islands for "Demnächst kochen" (see cooking.tsx): the recipe page /
 * cooking mode bar and the shopping-list suggestion. Auth headers come from
 * the global fetch wrapper in Layout.astro.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShoppingList } from '../types/recipe';
import { PurchaseSuggestionBanner, RecipeCookBar, type CreatePlan } from './cooking';

function alias(): string {
  try {
    return (localStorage.getItem('cookbook.alias') || '').trim();
  } catch {
    return '';
  }
}

/** Meal-prep batch via the tracker API — only with an alias (tracker data belongs to it). */
function websiteCreatePlan(): CreatePlan | undefined {
  const a = alias();
  if (!a) return undefined;
  return async (input) => {
    const res = await fetch('/api/tracker/meal-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: a, ...input }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || `HTTP ${res.status}`);
  };
}

export function WebsiteRecipeCookBar({ recipe, compact }: { recipe: { id: string; title: string; servings?: number }; compact?: boolean }) {
  return <RecipeCookBar recipe={recipe} createPlan={websiteCreatePlan()} compact={compact} />;
}

/** Re-reads the list after items were ticked on the page (the page saves via the API). */
export function WebsiteListCookSuggest({ listId }: { listId: string }) {
  const [list, setList] = useState<ShoppingList | null>(null);
  const timers = useRef<number[]>([]);
  const load = useCallback(() => {
    fetch(`/api/shopping-lists?id=${encodeURIComponent(listId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((l) => l && setList(l))
      .catch(() => undefined);
  }, [listId]);
  useEffect(() => {
    load();
    const onChange = (e: Event) => {
      if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'checkbox') return;
      // The page writes asynchronously — look again shortly after.
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [800, 2500].map((ms) => window.setTimeout(load, ms));
    };
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, [load]);
  if (!list || list.isPermanent) return null;
  return <PurchaseSuggestionBanner list={list} />;
}
