import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { runSync } from './lib/syncRunner';
import RecipesPage from './pages/RecipesPage';
import RecipeDetailPage from './pages/RecipeDetailPage';
import RecipeEditPage from './pages/RecipeEditPage';
import LocalDbTestPage from './pages/LocalDbTestPage';
import SyncTestPage from './pages/SyncTestPage';
import PushTestPage from './pages/PushTestPage';
import SettingsPage from './pages/SettingsPage';
import OptoutTestPage from './pages/OptoutTestPage';
import ProductsPage from './pages/ProductsPage';
import IngredientsPage from './pages/IngredientsPage';

/** Top-level navigation. Only Rezepte is wired in Phase 1; the rest are stubs. */
const NAV: { to: string; label: string; enabled: boolean }[] = [
  { to: '/', label: 'Rezepte', enabled: true },
  { to: '/einkaufslisten', label: 'Einkaufslisten', enabled: false },
  { to: '/produkte', label: 'Produkte', enabled: true },
  { to: '/zutaten', label: 'Zutaten', enabled: true },
  { to: '/einstellungen', label: 'Einstellungen', enabled: true }
];

function Nav() {
  return (
    <header className="sticky top-0 z-10 border-b border-secondary-200 bg-white/90 backdrop-blur dark:border-secondary-700 dark:bg-secondary-900/90">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3">
        <span className="mr-3 text-lg font-bold text-primary-600 dark:text-primary-400">
          Kochbuch
        </span>
        <nav className="flex gap-1 text-sm">
          {NAV.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  'rounded px-3 py-1.5 font-medium transition-colors ' +
                  (isActive
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-300 dark:hover:bg-secondary-800')
                }
                end={item.to === '/'}
              >
                {item.label}
              </NavLink>
            ) : (
              <span
                key={item.to}
                title="Kommt in einer späteren Phase"
                className="cursor-not-allowed rounded px-3 py-1.5 font-medium text-secondary-400 dark:text-secondary-600"
              >
                {item.label}
              </span>
            )
          )}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  const queryClient = useQueryClient();

  // Server-first background sync: refresh the local replica on load and whenever
  // the app regains focus, then re-render from local. If offline, the app keeps
  // showing local data (fallback).
  useEffect(() => {
    const sync = () => {
      runSync()
        .then((o) => {
          if (o.online && (o.applied || o.deleted)) queryClient.invalidateQueries();
        })
        .catch(() => {});
    };
    sync();
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [queryClient]);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<RecipesPage />} />
          <Route path="/rezept/neu" element={<RecipeEditPage />} />
          <Route path="/rezept/:id" element={<RecipeDetailPage />} />
          <Route path="/rezept/:id/bearbeiten" element={<RecipeEditPage />} />
          <Route path="/_localtest" element={<LocalDbTestPage />} />
          <Route path="/_synctest" element={<SyncTestPage />} />
          <Route path="/_pushtest" element={<PushTestPage />} />
          <Route path="/produkte" element={<ProductsPage />} />
          <Route path="/zutaten" element={<IngredientsPage />} />
          <Route path="/einstellungen" element={<SettingsPage />} />
          <Route path="/_optouttest" element={<OptoutTestPage />} />
          <Route
            path="*"
            element={<p className="text-secondary-500">Seite nicht gefunden.</p>}
          />
        </Routes>
      </main>
    </div>
  );
}
