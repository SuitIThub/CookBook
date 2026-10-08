/**
 * Start page — port of src/pages/index.astro (HomeLayout: no nav bar, icon
 * buttons top-right, logo, welcome text, two cards). Like the website, an
 * active alias forwards to the tracker unless ?welcome=1 is given.
 */
import { Link, Navigate, useLocation } from 'react-router-dom';
import { getAlias } from '@/lib/settings';
import { LowBandwidthToggle } from '@/components/settings/HeaderModals';
import { ThemeToggle, openAliasSettings, openAiSettings } from '@/components/settings/headerActions';

export default function HomePage() {
  const location = useLocation();
  if (getAlias() && !location.search.includes('welcome=1')) return <Navigate to="/tracker" replace />;

  return (
    <div className="relative">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LowBandwidthToggle mobile />
        <ThemeToggle large />
        <button type="button" onClick={openAliasSettings} className="btn-icon text-gray-700 hover:text-orange-500 dark:text-gray-300 dark:hover:text-orange-400" aria-label="Alias & Synchronisierung" title="Alias & Synchronisierung">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.83-4" /></svg>
        </button>
        <button type="button" onClick={openAiSettings} className="btn-icon text-gray-700 hover:text-indigo-500 dark:text-gray-300 dark:hover:text-indigo-400" aria-label="KI-Einstellungen öffnen" title="KI-Einstellungen">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317a1 1 0 011.35-.936l1.09.497a1 1 0 00.87 0l1.09-.497a1 1 0 011.35.936l.112 1.193a1 1 0 00.637.84l1.126.43a1 1 0 01.56 1.41l-.58 1.05a1 1 0 000 .966l.58 1.05a1 1 0 01-.56 1.41l-1.126.43a1 1 0 00-.637.84l-.112 1.193a1 1 0 01-1.35.936l-1.09-.497a1 1 0 00-.87 0l-1.09.497a1 1 0 01-1.35-.936l-.112-1.193a1 1 0 00-.637-.84l-1.126-.43a1 1 0 01-.56-1.41l.58-1.05a1 1 0 000-.966l-.58-1.05a1 1 0 01.56-1.41l1.126-.43a1 1 0 00.637-.84l.112-1.193z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
          </svg>
        </button>
      </div>
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="mb-8 flex justify-center">
          <img src="/icons/icon_alpha_128.svg" alt="Kochbuch Logo" className="mx-auto h-32 w-32" />
        </div>
        <h1 className="mb-8 text-6xl font-bold text-gray-900 dark:text-white">Kochbuch</h1>
        <h2 className="mb-12 text-center text-4xl font-bold dark:text-white">Willkommen in deinem digitalen Kochbuch</h2>
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-2">
          <Link to="/rezepte" className="group">
            <div className="rounded-lg bg-white p-8 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-gray-800 dark:shadow-gray-900">
              <div className="text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-4 h-16 w-16 text-orange-500 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h2 className="mb-4 text-2xl font-semibold dark:text-white">Rezepte</h2>
                <p className="text-gray-600 dark:text-gray-300">Entdecke und verwalte deine Lieblingsrezepte</p>
              </div>
            </div>
          </Link>
          <Link to="/einkaufslisten" className="group">
            <div className="rounded-lg bg-white p-8 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-gray-800 dark:shadow-gray-900">
              <div className="text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-4 h-16 w-16 text-green-500 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <h2 className="mb-4 text-2xl font-semibold dark:text-white">Einkaufslisten</h2>
                <p className="text-gray-600 dark:text-gray-300">Plane und organisiere deine Einkäufe</p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
