/**
 * Shared header actions: open the Alias/KI modals from anywhere (decoupled via
 * DOM events, like the website's data-open-* attributes) and the theme toggle.
 */
import { useEffect, useState } from 'react';

export const OPEN_ALIAS_EVENT = 'cookbook:open-alias-settings';
export const OPEN_AI_EVENT = 'cookbook:open-ai-settings';

export const openAliasSettings = () => document.dispatchEvent(new CustomEvent(OPEN_ALIAS_EVENT));
export const openAiSettings = () => document.dispatchEvent(new CustomEvent(OPEN_AI_EVENT));

/** Light/dark toggle (key `theme`, synced per alias like the website). */
export function ThemeToggle({ large = false }: { large?: boolean }) {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  // Follow changes made elsewhere (alias sync from another device).
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
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
  const cls = large ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <button onClick={toggle} className="btn-icon text-gray-700 hover:text-orange-500 dark:text-gray-300 dark:hover:text-orange-400" aria-label="Toggle dark mode" title="Farbschema wechseln">
      {dark ? (
        <svg className={cls} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className={cls} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586z" fillRule="evenodd" />
        </svg>
      )}
    </button>
  );
}
