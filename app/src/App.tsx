import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { runSync } from './lib/syncRunner';
import RecipesPage from './pages/RecipesPage';
import RecipeDetailPage from './pages/RecipeDetailPage';
import RecipeEditPage from './pages/RecipeEditPage';
import CookingModePage from './pages/CookingModePage';
import LocalDbTestPage from './pages/LocalDbTestPage';
import SyncTestPage from './pages/SyncTestPage';
import PushTestPage from './pages/PushTestPage';
import SettingsPage from './pages/SettingsPage';
import OptoutTestPage from './pages/OptoutTestPage';
import ProductsPage from './pages/ProductsPage';
import IngredientsPage from './pages/IngredientsPage';
import ShoppingListsPage from './pages/ShoppingListsPage';
import ShoppingListDetailPage from './pages/ShoppingListDetailPage';
import { CookingTimersProvider } from './components/recipe/CookingTimers';

const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Rezepte', end: true },
  { to: '/einkaufslisten', label: 'Einkaufslisten' },
  { to: '/zutaten', label: 'Zutaten' },
  { to: '/produkte', label: 'Produkte' }
];

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      onClick={toggle}
      className="btn-icon text-gray-700 hover:text-orange-500 dark:text-gray-300 dark:hover:text-orange-400"
      aria-label="Farbschema wechseln"
      title="Farbschema wechseln"
    >
      {dark ? (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586z" fillRule="evenodd" />
        </svg>
      )}
    </button>
  );
}

function SettingsLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavLink
      to="/einstellungen"
      onClick={onNavigate}
      className="btn-icon text-gray-700 hover:text-orange-500 dark:text-gray-300 dark:hover:text-orange-400"
      aria-label="Einstellungen"
      title="Einstellungen"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317a1 1 0 011.35-.936l1.09.497a1 1 0 00.87 0l1.09-.497a1 1 0 011.35.936l.112 1.193a1 1 0 00.637.84l1.126.43a1 1 0 01.56 1.41l-.58 1.05a1 1 0 000 .966l.58 1.05a1 1 0 01-.56 1.41l-1.126.43a1 1 0 00-.637.84l-.112 1.193a1 1 0 01-1.35.936l-1.09-.497a1 1 0 00-.87 0l-1.09.497a1 1 0 01-1.35-.936l-.112-1.193a1 1 0 00-.637-.84l-1.126-.43a1 1 0 01-.56-1.41l.58-1.05a1 1 0 000-.966l-.58-1.05a1 1 0 01.56-1.41l1.126-.43a1 1 0 00.637-.84l.112-1.193z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
      </svg>
    </NavLink>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  'nav-link' + (isActive ? ' text-orange-600 dark:text-orange-400' : '');

function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="nav-header">
      <nav className="container">
        <div className="flex h-16 justify-between">
          <div className="flex items-center">
            <NavLink to="/" className="flex items-center space-x-2">
              <img src="/icons/icon_alpha_32.svg" alt="Kochbuch Logo" className="h-8 w-8" />
              <span className="text-xl font-semibold text-gray-900 dark:text-white">Kochbuch</span>
            </NavLink>
          </div>

          {/* Desktop navigation */}
          <div className="hidden items-center space-x-4 desktop:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            <ThemeToggle />
            <SettingsLink />
          </div>

          {/* Mobile / tablet controls */}
          <div className="flex items-center space-x-2 desktop:hidden">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="btn-icon text-gray-700 hover:text-orange-500 dark:text-gray-300 dark:hover:text-orange-400"
              aria-label="Menü"
              aria-expanded={menuOpen}
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="mt-2 border-t border-gray-200 pb-4 pt-4 desktop:hidden dark:border-gray-700">
            <div className="flex flex-col space-y-3">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => navLinkClass({ isActive }) + ' text-base'}
                >
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to="/einstellungen"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => navLinkClass({ isActive }) + ' text-base'}
              >
                Einstellungen
              </NavLink>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}

export default function App() {
  const queryClient = useQueryClient();

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
    <CookingTimersProvider>
      <Nav />
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<RecipesPage />} />
          <Route path="/rezept/neu" element={<RecipeEditPage />} />
          <Route path="/rezept/:id" element={<RecipeDetailPage />} />
          <Route path="/rezept/:id/bearbeiten" element={<RecipeEditPage />} />
          <Route path="/rezept/:id/kochen" element={<CookingModePage />} />
          <Route path="/_localtest" element={<LocalDbTestPage />} />
          <Route path="/_synctest" element={<SyncTestPage />} />
          <Route path="/_pushtest" element={<PushTestPage />} />
          <Route path="/produkte" element={<ProductsPage />} />
          <Route path="/zutaten" element={<IngredientsPage />} />
          <Route path="/einkaufslisten" element={<ShoppingListsPage />} />
          <Route path="/einkaufsliste/:id" element={<ShoppingListDetailPage />} />
          <Route path="/einstellungen" element={<SettingsPage />} />
          <Route path="/_optouttest" element={<OptoutTestPage />} />
          <Route path="*" element={<p className="text-muted">Seite nicht gefunden.</p>} />
        </Routes>
      </main>
    </CookingTimersProvider>
  );
}
