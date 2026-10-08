import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { startAutoSync } from './lib/syncRunner';
import { installShareTarget } from './lib/shareTarget';
import { checkForUpdate, canInstallInApp, SHOW_UPDATE_EVENT, type AvailableUpdate } from './lib/appUpdate';
import UpdateDialog from './components/UpdateDialog';
import { installPush, PING_RECEIVED_EVENT } from './lib/push';
import type { PushNotificationSchema } from '@capacitor/push-notifications';
import SyncIndicator from './components/sync/SyncIndicator';
import { LowBandwidthToggle, AliasSettingsModal, AISettingsModal } from './components/settings/HeaderModals';
import { ThemeToggle, openAliasSettings, openAiSettings, OPEN_ALIAS_EVENT, OPEN_AI_EVENT } from './components/settings/headerActions';
import HomePage from './pages/HomePage';
import RecipesPage from './pages/RecipesPage';
import RecipeDetailPage from './pages/RecipeDetailPage';
import RecipeEditPage from './pages/RecipeEditPage';
import CookingModePage from './pages/CookingModePage';
import LocalDbTestPage from './pages/LocalDbTestPage';
import SyncTestPage from './pages/SyncTestPage';
import PushTestPage from './pages/PushTestPage';
import SettingsPage from './pages/SettingsPage';
import AdminAliasesPage from './pages/AdminAliasesPage';
import OptoutTestPage from './pages/OptoutTestPage';
import ProductsPage from './pages/ProductsPage';
import IngredientsPage from './pages/IngredientsPage';
import ShoppingListsPage from './pages/ShoppingListsPage';
import ShoppingListDetailPage from './pages/ShoppingListDetailPage';
import ShoppingListEditPage from './pages/ShoppingListEditPage';
import TrackerPage from './pages/TrackerPage';
import { CookingTimersProvider } from './components/recipe/CookingTimers';

const NAV: { to: string; label: string }[] = [
  { to: '/rezepte', label: 'Rezepte' },
  { to: '/einkaufslisten', label: 'Einkaufslisten' },
  { to: '/zutaten', label: 'Zutaten' },
  { to: '/produkte', label: 'Produkte' },
  { to: '/tracker', label: 'Tracker' }
];

const iconBtn = 'btn-icon text-gray-700 dark:text-gray-300';

function AliasButton() {
  return (
    <button type="button" onClick={openAliasSettings} className={iconBtn + ' hover:text-orange-500 dark:hover:text-orange-400'} aria-label="Alias & Synchronisierung" title="Alias & Synchronisierung">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.83-4" />
      </svg>
    </button>
  );
}

function AiButton() {
  return (
    <button type="button" onClick={openAiSettings} className={iconBtn + ' hover:text-indigo-500 dark:hover:text-indigo-400'} aria-label="KI-Einstellungen öffnen" title="KI-Einstellungen">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317a1 1 0 011.35-.936l1.09.497a1 1 0 00.87 0l1.09-.497a1 1 0 011.35.936l.112 1.193a1 1 0 00.637.84l1.126.43a1 1 0 01.56 1.41l-.58 1.05a1 1 0 000 .966l.58 1.05a1 1 0 01-.56 1.41l-1.126.43a1 1 0 00-.637.84l-.112 1.193a1 1 0 01-1.35.936l-1.09-.497a1 1 0 00-.87 0l-1.09.497a1 1 0 01-1.35-.936l-.112-1.193a1 1 0 00-.637-.84l-1.126-.43a1 1 0 01-.56-1.41l.58-1.05a1 1 0 000-.966l-.58-1.05a1 1 0 01.56-1.41l1.126-.43a1 1 0 00.637-.84l.112-1.193z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
      </svg>
    </button>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) => 'nav-link' + (isActive ? ' text-orange-600 dark:text-orange-400' : '');

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
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            {/* App-only: sync state of the offline replica */}
            <SyncIndicator />
            <LowBandwidthToggle />
            <AliasButton />
            <AiButton />
            <ThemeToggle />
          </div>

          {/* Mobile / tablet controls */}
          <div className="flex items-center space-x-2 desktop:hidden">
            <SyncIndicator />
            <LowBandwidthToggle mobile />
            <AliasButton />
            <AiButton />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className={iconBtn + ' hover:text-orange-500 dark:hover:text-orange-400'}
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
                <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => navLinkClass({ isActive }) + ' text-base'}>
                  {item.label}
                </NavLink>
              ))}
              {/* App-only: server address + full re-sync */}
              <NavLink to="/einstellungen" onClick={() => setMenuOpen(false)} className={({ isActive }) => navLinkClass({ isActive }) + ' text-base'}>
                Server &amp; Synchronisierung
              </NavLink>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}

/** Global Alias/KI/Update modals, opened from any page via openAliasSettings()/openAiSettings()/showUpdate(). */
function GlobalModals() {
  const [alias, setAlias] = useState(false);
  const [ai, setAi] = useState(false);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [ping, setPing] = useState<PushNotificationSchema | null>(null);
  const navigate = useNavigate();
  // A ping arriving while the app is open (Android shows nothing by itself).
  useEffect(() => {
    const onPing = (e: Event) => setPing((e as CustomEvent<PushNotificationSchema>).detail);
    document.addEventListener(PING_RECEIVED_EVENT, onPing);
    return () => document.removeEventListener(PING_RECEIVED_EVENT, onPing);
  }, []);
  // On app start (Android): offer a newer GitHub release.
  useEffect(() => {
    if (!canInstallInApp()) return;
    checkForUpdate().then((u) => u && setUpdate(u), () => {});
  }, []);
  useEffect(() => {
    const show = (e: Event) => setUpdate((e as CustomEvent<AvailableUpdate>).detail);
    document.addEventListener(SHOW_UPDATE_EVENT, show);
    return () => document.removeEventListener(SHOW_UPDATE_EVENT, show);
  }, []);
  useEffect(() => {
    const a = () => setAlias(true);
    const k = () => setAi(true);
    document.addEventListener(OPEN_ALIAS_EVENT, a);
    document.addEventListener(OPEN_AI_EVENT, k);
    return () => {
      document.removeEventListener(OPEN_ALIAS_EVENT, a);
      document.removeEventListener(OPEN_AI_EVENT, k);
    };
  }, []);
  return (
    <>
      {alias && <AliasSettingsModal onClose={() => setAlias(false)} />}
      {ai && <AISettingsModal onClose={() => setAi(false)} />}
      {update && <UpdateDialog update={update} onClose={() => setUpdate(null)} />}
      {ping && (
        <div className="fixed inset-x-3 top-3 z-[80] rounded-xl border border-orange-200 bg-white p-3 shadow-2xl dark:border-orange-800 dark:bg-gray-800">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{ping.title}</p>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{ping.body}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setPing(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
              Später
            </button>
            {typeof ping.data?.route === 'string' && (
              <button
                type="button"
                onClick={() => {
                  navigate(ping.data.route);
                  setPing(null);
                }}
                className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
              >
                Ansehen
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  // "Teilen → Kochbuch" (Android): a shared link opens the recipe import.
  useEffect(() => installShareTarget((to) => navigate(to)), [navigate]);
  // Pings (push): register this device for the alias; a tapped ping opens its list.
  useEffect(() => installPush((to) => navigate(to)), [navigate]);

  useEffect(
    // Sync on start, on focus/foreground, when back online, periodically and
    // when the server reports a change; refresh views when data changed.
    () => startAutoSync(() => queryClient.invalidateQueries()),
    [queryClient]
  );

  // Start page uses the website's HomeLayout (no nav bar).
  const isHome = location.pathname === '/';

  return (
    <CookingTimersProvider>
      {!isHome && <Nav />}
      <main className={isHome ? '' : 'container mx-auto px-4 py-8'}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rezepte" element={<RecipesPage />} />
          <Route path="/rezept/neu" element={<RecipeEditPage />} />
          <Route path="/rezept/:id" element={<RecipeDetailPage />} />
          <Route path="/rezept/:id/bearbeiten" element={<RecipeEditPage />} />
          <Route path="/rezept/:id/kochen" element={<CookingModePage />} />
          <Route path="/rezept/:parentId/variante-neu" element={<RecipeEditPage variantDraft />} />
          <Route path="/_localtest" element={<LocalDbTestPage />} />
          <Route path="/_synctest" element={<SyncTestPage />} />
          <Route path="/_pushtest" element={<PushTestPage />} />
          <Route path="/produkte" element={<ProductsPage />} />
          <Route path="/zutaten" element={<IngredientsPage />} />
          <Route path="/einkaufslisten" element={<ShoppingListsPage />} />
          <Route path="/einkaufsliste/:id" element={<ShoppingListDetailPage />} />
          <Route path="/einkaufsliste/:id/bearbeiten" element={<ShoppingListEditPage />} />
          <Route path="/tracker" element={<TrackerPage />} />
          <Route path="/einstellungen" element={<SettingsPage />} />
          <Route path="/admin/aliasse" element={<AdminAliasesPage />} />
          <Route path="/_optouttest" element={<OptoutTestPage />} />
          <Route path="*" element={<p className="text-muted">Seite nicht gefunden.</p>} />
        </Routes>
      </main>
      <GlobalModals />
    </CookingTimersProvider>
  );
}
