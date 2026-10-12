/**
 * /dashboard — the shared dashboard (src/dashboard, also the website's
 * /dashboard island) on top of the app's local data. Needs an alias, like
 * the website (layout + tracker data belong to it).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dashboard from '@dashboard/Dashboard';
import { DashboardDataProvider } from '@dashboard/data';
import { getAlias } from '@/lib/settings';
import { onAliasSettingsChanged } from '@/lib/aliasSync';
import { openAliasSettings } from '@/components/settings/headerActions';
import { createAppDashboardData } from '@/lib/dashboardData';

export default function DashboardPage() {
  const [alias, setAlias] = useState(getAlias);
  useEffect(() => onAliasSettingsChanged(() => setAlias(getAlias())), []);
  const navigate = useNavigate();
  const data = useMemo(() => createAppDashboardData(alias, navigate), [alias, navigate]);

  if (!alias) {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-center dark:border-yellow-700 dark:bg-yellow-900/20">
        <h1 className="mb-2 text-xl font-semibold text-yellow-900 dark:text-yellow-100">Dashboard benötigt einen Alias</h1>
        <p className="mb-4 text-sm text-yellow-800 dark:text-yellow-200">Dein Dashboard (Widgets und Anordnung) wird pro Alias gespeichert und auf deinen Geräten synchronisiert.</p>
        <button type="button" onClick={openAliasSettings} className="rounded bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600">
          Alias einrichten
        </button>
      </div>
    );
  }
  return (
    <DashboardDataProvider value={data}>
      <Dashboard key={alias} />
    </DashboardDataProvider>
  );
}
