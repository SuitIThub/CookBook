/**
 * Einkaufsliste (detail) — port of src/pages/einkaufsliste/[id].astro.
 *
 * Reads/writes the local replica (offline-first); sync pushes changes and the
 * three-way merge keeps concurrent edits of roommates. Structure, labels and
 * behaviour follow the website: header actions, Sammelliste/Vorlage import,
 * recipe cards with highlighting, grouping, notes, alternatives.
 */
import PingAliasesModal from '@/components/shopping_list/PingAliasesModal';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import type { ShoppingList, ShoppingListItem } from '@/types';
import {
  localShoppingList,
  localShoppingLists,
  updateLocalShoppingList,
  removeRecipeFromLocalShoppingList,
  setLocalRecipeServings,
  addItemToLocalShoppingList,
  localPermanentShoppingList,
  localGlobalTemplateShoppingList,
  transferFromLocalPermanentList,
  applyLocalGlobalTemplate,
  previewLocalAlternativeChange,
  switchLocalAlternative
} from '@/lib/localData';
import { runSync, subscribeSyncStatus, getSyncStatus, type SyncStatus } from '@/lib/syncRunner';
import { apiBase } from '@/lib/api';
import { unitOptions, formatQuantityForDisplay, amountText } from '@/lib/unitDisplay';
import ShoppingListMarketPanel from '@/components/ShoppingListMarketPanel';
import { ViewNotesModal, AddNoteModal, hasNote } from '@/components/shopping_list/NoteModals';

const PERMANENT_LIST_IDS = ['permanent-shopping-list', 'global-template-shopping-list'];

/* ------------------------------------------------------------- grouping */

interface Group {
  key: string;
  name: string;
  items: ShoppingListItem[];
  allChecked: boolean;
  anyChecked: boolean;
  descriptions: string[];
  quantities: { unitKey: string; unit: string; amount: number }[];
  isManualGroup: boolean;
  manualGroupId?: string;
}

/** Same grouping as the website: manual groups first, then by name (case-insensitive). */
function groupItems(items: ShoppingListItem[]): Group[] {
  const groups = new Map<string, Group>();
  const manual = new Map<string, ShoppingListItem[]>();
  const ungrouped: ShoppingListItem[] = [];
  for (const it of items) {
    if (it.manualGroupId) {
      if (!manual.has(it.manualGroupId)) manual.set(it.manualGroupId, []);
      manual.get(it.manualGroupId)!.push(it);
    } else ungrouped.push(it);
  }
  const addQty = (g: Group, it: ShoppingListItem) => {
    if (!it.quantity || !it.quantity.unit) return;
    const k = it.quantity.unit.toLowerCase();
    const q = g.quantities.find((x) => x.unitKey === k);
    if (q) q.amount += it.quantity.amount;
    else g.quantities.push({ unitKey: k, unit: it.quantity.unit, amount: it.quantity.amount });
  };
  manual.forEach((gi, gid) => {
    const g: Group = {
      key: `manual_${gid}`,
      name: gi.map((i) => i.name).join(', '),
      items: gi,
      allChecked: gi.every((i) => !!i.isChecked),
      anyChecked: gi.some((i) => !!i.isChecked),
      descriptions: [...new Set(gi.map((i) => i.description).filter((d): d is string => !!d))],
      quantities: [],
      isManualGroup: true,
      manualGroupId: gid
    };
    gi.forEach((i) => addQty(g, i));
    groups.set(g.key, g);
  });
  for (const it of ungrouped) {
    const key = it.name.toLowerCase();
    const ex = groups.get(key);
    if (ex) {
      ex.items.push(it);
      ex.allChecked = ex.allChecked && !!it.isChecked;
      ex.anyChecked = ex.anyChecked || !!it.isChecked;
      if (it.description && !ex.descriptions.includes(it.description)) ex.descriptions.push(it.description);
      addQty(ex, it);
    } else {
      const g: Group = {
        key,
        name: it.name,
        items: [it],
        allChecked: !!it.isChecked,
        anyChecked: !!it.isChecked,
        descriptions: it.description ? [it.description] : [],
        quantities: [],
        isManualGroup: false
      };
      addQty(g, it);
      groups.set(key, g);
    }
  }
  return Array.from(groups.values());
}

function recipeIngredientCount(list: ShoppingList, recipeId: string) {
  return list.items.filter((i) => i.recipeId === recipeId).length;
}

/* ------------------------------------------------------------------- page */

export default function ShoppingListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: list, isLoading, isError } = useQuery({
    queryKey: ['shoppingList', id],
    queryFn: () => localShoppingList(id!),
    enabled: !!id
  });
  const { data: permanent } = useQuery({ queryKey: ['shoppingList', 'permanent-shopping-list'], queryFn: localPermanentShoppingList });
  const { data: template } = useQuery({ queryKey: ['shoppingList', 'global-template-shopping-list'], queryFn: localGlobalTemplateShoppingList });

  const [search, setSearch] = useState('');
  const [hideChecked, setHideChecked] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [viewNotes, setViewNotes] = useState<ShoppingListItem[] | null>(null);
  const [addNote, setAddNote] = useState<ShoppingListItem[] | null>(null);
  const [altMenu, setAltMenu] = useState<{ recipeId: string; groupId: string; current: string; top: number; left: number } | null>(null);
  const [altWarning, setAltWarning] = useState<{ removed: { name: string; quantity?: { amount: number; unit: string } }[]; run: () => void } | null>(null);
  const [importOpen, setImportOpen] = useState<boolean | null>(null);
  const [bannerHidden, setBannerHidden] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [dupModal, setDupModal] = useState<{ targetId: string; recipeIds: string[] } | null>(null);
  const [shareDone, setShareDone] = useState(false);
  const [pingOpen, setPingOpen] = useState(false);
  const [sync, setSync] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => subscribeSyncStatus(setSync), []);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shoppingList'] });
    queryClient.invalidateQueries({ queryKey: ['shoppingLists'] });
    runSync().catch(() => {});
  };

  const summary = (l: ShoppingList | null | undefined) =>
    l && (l.items.length > 0 || (l.recipes?.length ?? 0) > 0) ? { itemCount: l.items.length, recipeCount: l.recipes?.length ?? 0 } : null;
  const permanentSummary = list && !list.isPermanent ? summary(permanent) : null;
  const templateSummary = list && !list.isPermanent && !list.hasSeenGlobalTemplatePrompt ? summary(template) : null;

  // "Einträge übernehmen?" is decided once, when the list is first shown (like the SSR page).
  useEffect(() => {
    if (importOpen !== null || !list || permanent === undefined || template === undefined) return;
    setImportOpen(!list.isPermanent && !list.hasSeenGlobalTemplatePrompt && !!(permanentSummary || templateSummary));
  }, [list, permanent, template]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (!list) return [];
    let items = list.items;
    if (hideChecked) items = items.filter((i) => !i.isChecked);
    const all = groupItems(items);
    const term = search.toLowerCase().trim();
    if (!term) return all;
    return all.filter(
      (g) =>
        g.name.toLowerCase().includes(term) ||
        g.descriptions.some((d) => d.toLowerCase().includes(term)) ||
        g.quantities.some((q) => q.unit.toLowerCase().includes(term)) ||
        g.items.some((i) => i.name.toLowerCase().includes(term))
    );
  }, [list, hideChecked, search]);

  // Keep highlighted multi-item groups expanded (website auto-expands them).
  const isExpanded = (g: Group) =>
    expanded.has(g.key) || (!!highlighted && g.items.length > 1 && g.items.some((i) => i.recipeId === highlighted));

  if (isLoading) return <p className="text-secondary-500">Lade Liste …</p>;
  if (isError || !list) {
    return (
      <div className="container-narrow">
        <p className="text-red-600 dark:text-red-400">Liste nicht gefunden.</p>
        <Link to="/einkaufslisten" className="text-primary-600 hover:underline">← Einkaufslisten</Link>
      </div>
    );
  }

  const unchecked = list.items.filter((i) => !i.isChecked);
  const setItems = (items: ShoppingListItem[]) => updateLocalShoppingList(list.id, { items }).then(refresh);
  const hasManualGroups = list.items.some((i) => i.manualGroupId);

  /* ---- actions */

  const toggleChecked = (g: Group, checked: boolean) => {
    const ids = new Set(g.items.map((i) => i.id));
    return setItems(list.items.map((i) => (ids.has(i.id) ? { ...i, isChecked: checked } : i)));
  };

  const confirmGrouping = async () => {
    if (groupSel.size < 2) {
      alert('Bitte wählen Sie mindestens 2 Gruppen aus.');
      return;
    }
    const newGroupId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const ids = new Set(groups.filter((g) => groupSel.has(g.key)).flatMap((g) => g.items.map((i) => i.id)));
    await setItems(list.items.map((i) => (ids.has(i.id) ? { ...i, manualGroupId: newGroupId } : i)));
    setGroupMode(false);
    setGroupSel(new Set());
  };

  const ungroupAll = async () => {
    if (!hasManualGroups) return;
    if (!confirm('Möchten Sie wirklich alle manuellen Gruppierungen aufheben?')) return;
    await setItems(list.items.map(({ manualGroupId: _m, ...rest }) => rest));
  };

  const applySuggestions = async (accepted: ShoppingListItem[][]) => {
    if (accepted.length === 0) {
      alert('Bitte wählen Sie mindestens eine Gruppierung aus.');
      return;
    }
    const assign = new Map<string, string>();
    accepted.forEach((g, index) => {
      const gid = `manual_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
      g.forEach((it) => assign.set(it.id, gid));
    });
    await setItems(list.items.map((i) => (assign.has(i.id) ? { ...i, manualGroupId: assign.get(i.id)! } : i)));
    setShowSuggest(false);
    alert(`${accepted.length} Gruppierung${accepted.length !== 1 ? 'en' : ''} wurde${accepted.length !== 1 ? 'n' : ''} angewendet!`);
  };

  const changeServings = async (recipeId: string, servings: number) => {
    if (!servings || servings < 1) return;
    await setLocalRecipeServings(list.id, recipeId, servings);
    refresh();
  };

  const removeRecipe = async (recipeId: string) => {
    if (!confirm('Möchten Sie dieses Rezept wirklich aus der Einkaufsliste entfernen?')) return;
    await removeRecipeFromLocalShoppingList(list.id, recipeId);
    if (highlighted === recipeId) setHighlighted(null);
    refresh();
  };

  const toggleHighlight = (recipeId: string) => {
    setExpanded(new Set());
    setHighlighted((h) => (h === recipeId ? null : recipeId));
  };

  const share = async () => {
    const url = `${apiBase() || window.location.origin}/einkaufsliste/${list.id}`;
    const data = { title: list.title, text: `Einkaufsliste: ${list.title}`, url };
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ ...data, dialogTitle: 'Einkaufsliste teilen' });
      } else if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(url);
        setShareDone(true);
        setTimeout(() => setShareDone(false), 2000);
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const saveNote = async (itemId: string, note: string | undefined) => {
    const fresh = (await localShoppingList(list.id)) ?? list;
    const items = fresh.items.map((i) => {
      if (i.id !== itemId) return i;
      const { noteRef: _r, ...rest } = i;
      return { ...rest, note };
    });
    await updateLocalShoppingList(list.id, { items });
    refresh();
  };

  const requestSwitchAlternative = async (recipeId: string, groupId: string, optionId: string) => {
    const run = async () => {
      const res = await switchLocalAlternative(list.id, recipeId, groupId, optionId);
      if (!res) alert('Fehler beim Wechseln der Alternative');
      refresh();
    };
    try {
      const preview = await previewLocalAlternativeChange(list.id, recipeId, groupId, optionId);
      const removed = preview?.removedChecked ?? [];
      if (removed.length > 0) {
        setAltWarning({ removed: removed as any, run });
        return;
      }
    } catch (e) {
      console.error('Error previewing alternative switch', e);
    }
    await run();
  };

  /** Apply the "Einträge übernehmen?" choices (closing = decline the open ones). */
  const finishImport = async (choices: { sammelliste: boolean; template: boolean }) => {
    setImportOpen(false);
    await updateLocalShoppingList(list.id, { hasSeenGlobalTemplatePrompt: true });
    let duplicates: string[] = [];
    if (choices.sammelliste && permanentSummary) {
      const res = await transferFromLocalPermanentList(list.id);
      if (!res) alert('Übernahme von der Sammelliste fehlgeschlagen');
      else duplicates = res.duplicateRecipeIds;
    }
    if (choices.template && templateSummary) {
      const res = await applyLocalGlobalTemplate(list.id);
      if (!res) alert('Fehler beim Anwenden der Vorlage');
    }
    refresh();
    if (duplicates.length > 0) setDupModal({ targetId: list.id, recipeIds: duplicates });
  };

  const transferFromBanner = async () => {
    const res = await transferFromLocalPermanentList(list.id);
    if (!res) {
      alert('Übernahme fehlgeschlagen');
      return;
    }
    setBannerHidden(true);
    refresh();
    if (res.duplicateRecipeIds.length > 0) setDupModal({ targetId: list.id, recipeIds: res.duplicateRecipeIds });
    else alert('Einträge von der Sammelliste wurden übernommen.');
  };

  /* ---- render */

  const statusBadge =
    sync.phase === 'offline' ? (
      <span className="flex items-center space-x-1 text-xs text-red-600 dark:text-red-400"><span className="h-2 w-2 rounded-full bg-red-500" /><span>Offline</span></span>
    ) : sync.phase === 'syncing' ? (
      <span className="flex items-center space-x-1 text-xs text-blue-600 dark:text-blue-400"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" /><span>Synchronisiert</span></span>
    ) : (
      <span className="flex items-center space-x-1 text-xs text-green-600 dark:text-green-400"><span className="h-2 w-2 rounded-full bg-green-500" /><span>Live</span></span>
    );

  const showBanner = !list.isPermanent && !!list.hasSeenGlobalTemplatePrompt && !!permanentSummary && !bannerHidden && !importOpen;

  return (
    <div className="container-narrow">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center sm:gap-0">
          <div className="flex items-center space-x-3">
            <Link to="/einkaufslisten" className="btn btn-ghost btn-sm flex items-center space-x-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              <span>Zurück</span>
            </Link>
            <div>{statusBadge}</div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:space-x-2">
            <button onClick={() => setAddItemOpen(true)} className="btn btn-success flex items-center justify-center space-x-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              <span>Artikel hinzufügen</span>
            </button>
            <button onClick={() => navigate(`/rezepte?addToList=${encodeURIComponent(list.id)}`)} className="btn btn-blue flex items-center justify-center space-x-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
              <span>Rezept hinzufügen</span>
            </button>
            <button onClick={share} className="btn btn-secondary flex items-center justify-center space-x-2">
              {shareDone ? (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <span>Link kopiert!</span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" /></svg>
                  <span>Teilen</span>
                </>
              )}
            </button>
            <button onClick={() => setPingOpen(true)} className="btn btn-secondary flex items-center justify-center space-x-2" title="Andere Aliasse per App-Benachrichtigung auf die Liste hinweisen">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              <span>Anpingen</span>
            </button>
            <Link to={`/einkaufsliste/${list.id}/bearbeiten`} className="btn btn-secondary flex items-center justify-center space-x-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              <span>Bearbeiten</span>
            </Link>
            {list.isPermanent && (
              <button
                type="button"
                onClick={() => setApplyOpen(true)}
                className="btn btn-primary flex items-center justify-center space-x-2"
                title={list.permanentType === 2 ? 'Inhalt zu einer Einkaufsliste hinzufügen (Kopie)' : 'Inhalt in eine Einkaufsliste übernehmen (wird hier entfernt)'}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                <span>{list.permanentType === 2 ? 'Zu Liste hinzufügen' : 'In Liste übernehmen'}</span>
              </button>
            )}
          </div>
        </div>
        <div>
          <h1 className="heading-primary">{list.title}</h1>
          {list.description && <p className="text-muted mt-1">{list.description}</p>}
          <p className="text-muted mt-1 text-sm">{unchecked.length} von {list.items.length} Artikeln offen</p>
        </div>
      </div>

      <ShoppingListMarketPanel list={list} onChanged={refresh} />

      {showBanner && permanentSummary && (
        <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-4 dark:border-primary-700 dark:bg-primary-900/20">
          <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
            Auf Ihrer <strong>Sammelliste</strong> befinden sich {permanentSummary.itemCount} Artikel und {permanentSummary.recipeCount} Rezept{permanentSummary.recipeCount !== 1 ? 'e' : ''}. Möchten Sie diese in diese Einkaufsliste übernehmen?
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={transferFromBanner} className="btn btn-primary btn-sm">In diese Liste übernehmen</button>
            <button type="button" onClick={() => setBannerHidden(true)} className="btn btn-ghost btn-sm text-muted">Später</button>
          </div>
        </div>
      )}

      {/* Recipes */}
      {list.recipes.length > 0 && (
        <div className="card">
          <div className="card-content">
            <h2 className="heading-secondary mb-4">Rezepte</h2>
            <div className="space-y-3">
              {list.recipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id + ':' + (recipe.currentServings ?? recipe.servings)}
                  recipe={recipe}
                  count={recipeIngredientCount(list, recipe.id)}
                  active={highlighted === recipe.id}
                  onHighlight={() => toggleHighlight(recipe.id)}
                  onServings={(n) => changeServings(recipe.id, n)}
                  onRemove={() => removeRecipe(recipe.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Hide checked + grouping controls */}
      <div className="card mt-6">
        <div className="card-content">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {!list.isPermanent ? (
              <label className="flex cursor-pointer items-center space-x-3">
                <input type="checkbox" checked={hideChecked} onChange={(e) => setHideChecked(e.target.checked)} className="h-5 w-5 rounded border-gray-300 bg-gray-100 text-primary-500 focus:ring-2 focus:ring-primary-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Erledigte Artikel ausblenden</span>
              </label>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              {!groupMode && (
                <>
                  <button onClick={() => setShowSuggest(true)} className="btn btn-secondary btn-sm flex items-center space-x-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                    <span>Gruppierung vorschlagen</span>
                  </button>
                  <button onClick={() => { setGroupMode(true); setGroupSel(new Set()); }} className="btn btn-secondary btn-sm flex items-center space-x-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    <span>Gruppieren</span>
                  </button>
                  {hasManualGroups && (
                    <button onClick={ungroupAll} className="btn btn-secondary btn-sm flex items-center space-x-2">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                      <span>Gruppierung aufheben</span>
                    </button>
                  )}
                </>
              )}
              {groupMode && (
                <div className="flex items-center gap-2">
                  <button onClick={confirmGrouping} disabled={groupSel.size < 2} className="btn btn-success btn-sm">Gruppierung bestätigen</button>
                  <button onClick={() => { setGroupMode(false); setGroupSel(new Set()); }} className="btn btn-secondary btn-sm">Abbrechen</button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">{groupSel.size} ausgewählt</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="card mt-6">
        <div className="card-content">
          <h2 className="heading-secondary mb-4">Einkaufsliste ({list.items.length} Artikel)</h2>
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-orange-400"
              placeholder="Zutaten durchsuchen..."
            />
          </div>
          <div className="space-y-2">
            {groups.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-gray-300 py-8 text-center dark:border-gray-600">
                <svg className="mx-auto mb-3 h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v11a2 2 0 002 2h5.586a1 1 0 00.707-.293l5.414-5.414a1 1 0 00.293-.707V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                {search.trim() ? (
                  <p className="text-muted mb-2">Keine Artikel gefunden für "{search}"</p>
                ) : (
                  <>
                    <p className="text-muted mb-2">Noch keine Artikel in der Einkaufsliste</p>
                    <p className="text-muted text-sm">Klicken Sie auf "Artikel hinzufügen" um zu beginnen</p>
                  </>
                )}
              </div>
            ) : (
              groups.map((g, index) => (
                <ItemGroupRow
                  key={g.key}
                  group={g}
                  index={index}
                  list={list}
                  groupMode={groupMode}
                  selected={groupSel.has(g.key)}
                  expanded={isExpanded(g)}
                  highlighted={highlighted}
                  onSelect={(on) =>
                    setGroupSel((s) => {
                      const n = new Set(s);
                      if (on) n.add(g.key);
                      else n.delete(g.key);
                      return n;
                    })
                  }
                  onToggleExpand={() =>
                    setExpanded((s) => {
                      const n = new Set(s);
                      if (isExpanded(g)) n.delete(g.key);
                      else n.add(g.key);
                      return n;
                    })
                  }
                  onCheck={(c) => toggleChecked(g, c)}
                  onHighlight={(rid) => toggleHighlight(rid)}
                  onViewNotes={(items) => setViewNotes(items)}
                  onAddNote={(items) => setAddNote(items)}
                  onAltMenu={(m) => setAltMenu(m)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {pingOpen && <PingAliasesModal listId={list.id} onClose={() => setPingOpen(false)} />}
      {addItemOpen && (
        <AddItemModal
          onClose={() => setAddItemOpen(false)}
          onAdd={async (item) => {
            await addItemToLocalShoppingList(list.id, item);
            setAddItemOpen(false);
            refresh();
          }}
        />
      )}
      {showSuggest && <SuggestGroupingModal items={list.items} onClose={() => setShowSuggest(false)} onApply={applySuggestions} />}
      {viewNotes && <ViewNotesModal listId={list.id} items={viewNotes} onClose={() => setViewNotes(null)} />}
      {addNote && <AddNoteModal listId={list.id} items={addNote} onClose={() => setAddNote(null)} onSave={saveNote} />}
      {altMenu && (
        <AlternativeMenu
          list={list}
          menu={altMenu}
          onClose={() => setAltMenu(null)}
          onPick={(optionId) => {
            const m = altMenu;
            setAltMenu(null);
            if (optionId !== m.current) void requestSwitchAlternative(m.recipeId, m.groupId, optionId);
          }}
        />
      )}
      {altWarning && (
        <SimpleModal title="Abgehakte Zutaten gehen verloren" onClose={() => setAltWarning(null)}>
          <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">Durch das Wechseln der Alternative fallen die folgenden bereits abgehakten Zutaten aus der Liste:</p>
          <ul className="mb-4 max-h-60 list-inside list-disc overflow-y-auto text-sm text-gray-600 dark:text-gray-400">
            {altWarning.removed.map((r, i) => (
              <li key={i}>
                {r.quantity && (r.quantity.amount || r.quantity.amount === 0) ? `${r.quantity.amount}${r.quantity.unit ? ' ' + r.quantity.unit : ''} ` : ''} {r.name}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" className="btn btn-danger" onClick={() => { const run = altWarning.run; setAltWarning(null); run(); }}>Trotzdem wechseln</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAltWarning(null)}>Abbrechen</button>
          </div>
        </SimpleModal>
      )}
      {importOpen && (
        <ImportSourcesModal permanentSummary={permanentSummary} templateSummary={templateSummary} onFinish={finishImport} />
      )}
      {applyOpen && (
        <ApplyPermanentModal
          list={list}
          onClose={() => setApplyOpen(false)}
          onApplied={(targetId, duplicates) => {
            setApplyOpen(false);
            refresh();
            if (duplicates.length > 0) setDupModal({ targetId, recipeIds: duplicates });
          }}
        />
      )}
      {dupModal && (
        <SimpleModal title="Rezepte bereits in der Liste" onClose={() => { setDupModal(null); refresh(); }}>
          <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">Die folgenden Rezepte sind bereits in dieser Einkaufsliste. Sollen die Portionen addiert werden?</p>
          <ul className="mb-4 list-inside list-disc text-sm text-gray-600 dark:text-gray-400">
            {[...(permanent?.recipes ?? []), ...list.recipes]
              .filter((r, i, a) => dupModal.recipeIds.includes(r.id) && a.findIndex((x) => x.id === r.id) === i)
              .map((r) => <li key={r.id}>{r.title}</li>)}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const res = await transferFromLocalPermanentList(dupModal.targetId, dupModal.recipeIds);
                setDupModal(null);
                refresh();
                alert(res ? 'Portionen wurden addiert. Einträge von der Sammelliste wurden übernommen.' : 'Fehler beim Addieren der Portionen.');
              }}
            >
              Ja, Portionen addieren
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { setDupModal(null); refresh(); alert('Übernahme abgeschlossen. Die genannten Rezepte bleiben auf der Sammelliste.'); }}>Nein</button>
          </div>
        </SimpleModal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ recipe card */

function RecipeCard({
  recipe,
  count,
  active,
  onHighlight,
  onServings,
  onRemove
}: {
  recipe: ShoppingList['recipes'][number];
  count: number;
  active: boolean;
  onHighlight: () => void;
  onServings: (n: number) => void;
  onRemove: () => void;
}) {
  const current = recipe.currentServings || recipe.servings;
  const [value, setValue] = useState(String(current));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className={'recipe-item cursor-pointer rounded-lg border border-gray-300 p-4 transition-all hover:shadow-sm dark:border-gray-600' + (active ? ' active' : '')}
      onClick={onHighlight}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="recipe-title font-medium text-gray-900 dark:text-white">{recipe.title}</h3>
          <div className="ml-4 flex flex-shrink-0 items-center space-x-2">
            <Link to={`/rezept/${recipe.id}`} onClick={stop} className="btn btn-sm btn-ghost" title="Rezept anzeigen">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </Link>
            <button onClick={(e) => { stop(e); onRemove(); }} className="btn btn-sm btn-ghost text-gray-400 hover:text-red-500" title="Rezept entfernen">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-muted text-sm">{count} Zutaten in der Liste</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Portionen:</label>
              <div className="flex items-center space-x-1" onClick={stop}>
                <button className="btn btn-icon btn-sm" title="Portionen verringern" onClick={() => current > 1 && onServings(current - 1)}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                </button>
                <input
                  type="number"
                  min={1}
                  className="form-input form-input-sm w-16 text-center"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(value, 10);
                    if (n >= 1 && n !== current) onServings(n);
                    else setValue(String(current));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <button className="btn btn-icon btn-sm" title="Portionen erhöhen" onClick={() => onServings(current + 1)}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                </button>
              </div>
            </div>
            <span className="text-sm text-gray-500">Originalportionen: {recipe.servings}</span>
          </div>
          <p className="mt-1 text-xs text-blue-600 opacity-75 dark:text-blue-400">Klicken zum Hervorheben</p>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- item row */

function ItemGroupRow({
  group,
  index,
  list,
  groupMode,
  selected,
  expanded,
  highlighted,
  onSelect,
  onToggleExpand,
  onCheck,
  onHighlight,
  onViewNotes,
  onAddNote,
  onAltMenu
}: {
  group: Group;
  index: number;
  list: ShoppingList;
  groupMode: boolean;
  selected: boolean;
  expanded: boolean;
  highlighted: string | null;
  onSelect: (on: boolean) => void;
  onToggleExpand: () => void;
  onCheck: (checked: boolean) => void;
  onHighlight: (recipeId: string) => void;
  onViewNotes: (items: ShoppingListItem[]) => void;
  onAddNote: (items: ShoppingListItem[]) => void;
  onAltMenu: (m: { recipeId: string; groupId: string; current: string; top: number; left: number }) => void;
}) {
  const isChecked = group.allChecked;
  const partial = group.anyChecked && !group.allChecked;
  const multi = group.items.length > 1;
  const recipeIds = [...new Set(group.items.map((i) => i.recipeId).filter((r): r is string => !!r))];
  const quantities = group.quantities
    .map((q) => {
      const f = formatQuantityForDisplay(q.amount, q.unit);
      return { text: `${amountText(f.amount)} ${f.unit}`, numeric: q.amount };
    })
    .filter((q) => q.numeric !== 0);
  const groupHasNote = group.items.some(hasNote);
  const isHighlighted = !!highlighted && recipeIds.includes(highlighted);
  const qtyClass = isChecked
    ? 'text-sm text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-800 px-3 py-1.5 rounded border border-green-200 dark:border-green-700'
    : 'text-sm bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600';

  const altItem = group.items.find((it) => it.alternativeGroupId && it.recipeId);
  const altRecipe = altItem ? list.recipes.find((r) => r.id === altItem.recipeId) : undefined;
  const altSel = altRecipe?.alternativeSelections?.find((s) => s.groupId === altItem!.alternativeGroupId);
  const showAlt = !!altSel && altSel.options.length > 1;

  // Long-press (mobile) opens the add-note editor, like the website.
  const lp = useRef<{ t: ReturnType<typeof setTimeout> | null; x: number; y: number }>({ t: null, x: 0, y: 0 });
  const cancelLp = () => {
    if (lp.current.t) clearTimeout(lp.current.t);
    lp.current.t = null;
  };

  return (
    <div
      className={
        'shopping-item-group border-b border-gray-200 last:border-b-0 dark:border-gray-700 ' +
        (index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50') +
        (selected ? ' ring-2 ring-blue-500' : '') +
        (isHighlighted ? ' highlighted' : '')
      }
    >
      <div
        className={'shopping-item group rounded-lg p-3 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700' + (multi ? ' cursor-pointer' : '')}
        onClick={(e) => {
          if (!multi || groupMode) return;
          if ((e.target as HTMLElement).closest('input,button,a')) return;
          onToggleExpand();
        }}
        onTouchStart={(e) => {
          if ((e.target as HTMLElement).closest('input,button,a')) return;
          const t = e.touches[0];
          lp.current.x = t?.clientX ?? 0;
          lp.current.y = t?.clientY ?? 0;
          lp.current.t = setTimeout(() => {
            lp.current.t = null;
            onAddNote(group.items);
          }, 500);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t && (Math.abs(t.clientX - lp.current.x) > 15 || Math.abs(t.clientY - lp.current.y) > 15)) cancelLp();
        }}
        onTouchEnd={cancelLp}
        onTouchCancel={cancelLp}
      >
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {groupMode && (
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="h-5 w-5 flex-shrink-0 rounded border-gray-300 bg-gray-100 text-blue-600 focus:ring-2 focus:ring-blue-500" />
          )}
          {list.isPermanent ? (
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-gray-400 dark:text-gray-500" title="Auf der Sammelliste können Artikel nicht abgehakt werden">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </span>
          ) : (
            <input
              type="checkbox"
              checked={isChecked}
              disabled={groupMode}
              title={partial ? 'Teilweise erledigt' : groupMode ? 'Gruppierungsmodus aktiv' : ''}
              onChange={(e) => onCheck(e.target.checked)}
              className={'item-checkbox h-5 w-5 flex-shrink-0 rounded border-gray-300 bg-gray-100 text-green-600 focus:ring-2 focus:ring-green-500' + (partial ? ' opacity-50' : '') + (groupMode ? ' cursor-not-allowed opacity-50' : '')}
            />
          )}
          <span className={'flex-shrink-0 font-medium transition-colors ' + (isChecked ? 'text-green-800 line-through dark:text-green-300' : 'text-gray-900 dark:text-white')}>
            {group.name}
            {multi && <span className="ml-1 text-xs text-gray-500">({group.items.length}x)</span>}
            {group.isManualGroup && <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">(Manuell gruppiert)</span>}
          </span>
          {group.descriptions.length > 0 && (
            <p className={'flex-shrink-0 text-sm transition-colors ' + (isChecked ? 'text-green-700 line-through dark:text-green-300' : 'text-muted')}>{group.descriptions.join(', ')}</p>
          )}
          <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
            {showAlt && (
              <button
                type="button"
                className="h-5 w-5 flex-shrink-0 text-purple-600 transition-colors hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200"
                title="Alternative wechseln"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  onAltMenu({ recipeId: altItem!.recipeId!, groupId: altItem!.alternativeGroupId!, current: altItem!.alternativeOptionId || '', top: r.bottom + 4, left: r.left });
                }}
              >
                <svg className="h-full w-full" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m4 6H4m0 0l4 4m-4-4l4-4" /></svg>
              </button>
            )}
            {recipeIds.length > 0 && (
              <button className="h-5 w-5 flex-shrink-0 text-blue-600 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200" title="Rezept hervorheben" onClick={() => onHighlight(recipeIds[0])}>
                <svg className="h-full w-full" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
              </button>
            )}
            {multi && (
              <svg className="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-200" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            )}
            <button type="button" className="add-note-plus-btn flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-lg leading-none text-gray-500 transition-colors hover:bg-gray-200 hover:text-orange-500 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-gray-600 dark:hover:text-orange-400" title="Notiz hinzufügen" aria-label="Notiz hinzufügen" onClick={() => onAddNote(group.items)}>+</button>
            {quantities.length > 0 && <span className={qtyClass + ' flex-shrink-0'}>{quantities[0].text}</span>}
            {groupHasNote && (
              <button type="button" className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-blue-600 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200" title="Notizen anzeigen" aria-label="Notizen anzeigen" onClick={() => onViewNotes(group.items)}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </button>
            )}
          </div>
        </div>
        {quantities.length > 1 && (
          <div className="mt-1.5 flex flex-col items-end gap-1.5">
            {quantities.slice(1).map((q, i) => (
              <span key={i} className={qtyClass}>{q.text}</span>
            ))}
          </div>
        )}
      </div>
      {multi && expanded && (
        <div className="item-details ml-8 mr-4 mt-2 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
          <div className="p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Einzelne Mengen:</div>
            {group.items.map((item) => {
              const f = item.quantity && item.quantity.amount !== 0 ? formatQuantityForDisplay(item.quantity.amount, item.quantity.unit) : null;
              return (
                <div key={item.id} className={'detail-item group flex items-center justify-between px-2 py-1 text-sm transition-colors' + (highlighted && item.recipeId === highlighted ? ' detail-item-highlighted' : '')}>
                  <div className="flex min-w-0 items-center space-x-2">
                    <span className={(item.recipeId ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400') + ' text-xs font-medium'}>{item.recipeId ? '🍳 Rezept' : '✋ Manuell'}</span>
                    {item.description && <span className="truncate text-gray-500">• {item.description}</span>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {f && <span className="font-mono text-gray-700 dark:text-gray-300">{amountText(f.amount)} {f.unit}</span>}
                    {hasNote(item) && (
                      <button type="button" className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-blue-600 hover:text-blue-800 dark:text-blue-400" title="Notiz anzeigen" aria-label="Notiz anzeigen" onClick={() => onViewNotes([item])}>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </button>
                    )}
                    <button type="button" className="add-note-plus-btn flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-sm leading-none text-gray-400 opacity-0 transition-colors hover:bg-gray-200 hover:text-orange-500 group-hover:opacity-100 dark:hover:bg-gray-600 dark:hover:text-orange-400" title="Notiz hinzufügen" aria-label="Notiz hinzufügen" onClick={() => onAddNote([item])}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- small modals */

function SimpleModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal">
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function AddItemModal({ onClose, onAdd }: { onClose: () => void; onAdd: (item: Omit<ShoppingListItem, 'id'>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [description, setDescription] = useState('');
  const units = useMemo(unitOptions, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Bitte geben Sie einen Namen für den Artikel ein.');
      return;
    }
    const a = amount && !isNaN(parseFloat(amount)) ? parseFloat(amount) : null;
    const u = unit.trim() || null;
    const item: Omit<ShoppingListItem, 'id'> = { name: name.trim(), description: description.trim() || undefined, isChecked: false };
    if (a !== null && u !== null) item.quantity = { amount: a, unit: u };
    await onAdd(item);
  };
  return (
    <div className="modal">
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Artikel hinzufügen</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form id="add-item-form" className="modal-body space-y-4" onSubmit={submit}>
          <div>
            <label htmlFor="item-name" className="form-label">Name</label>
            <input id="item-name" autoFocus className="form-input" placeholder="z.B. Milch, Brot, Äpfel..." value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-amount" className="form-label">Menge (optional)</label>
              <input id="item-amount" type="number" className="form-input" placeholder="1" step="0.1" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <label htmlFor="item-unit" className="form-label">Einheit (optional)</label>
              <select id="item-unit" className="form-input" value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="">Einheit wählen...</option>
                {units.map((u) => (
                  <option key={u.name} value={u.name}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="item-description" className="form-label">Beschreibung (optional)</label>
            <input id="item-description" className="form-input" placeholder="z.B. Bio, 1,5% Fett..." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </form>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary modal-close" style={{ minWidth: 100 }} onClick={onClose}>Abbrechen</button>
          <button type="submit" form="add-item-form" className="btn btn-success" style={{ minWidth: 100 }}>Hinzufügen</button>
        </div>
      </div>
    </div>
  );
}

function AlternativeMenu({
  list,
  menu,
  onClose,
  onPick
}: {
  list: ShoppingList;
  menu: { recipeId: string; groupId: string; current: string; top: number; left: number };
  onClose: () => void;
  onPick: (optionId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', close);
    };
  }, [onClose]);
  const recipe = list.recipes.find((r) => r.id === menu.recipeId);
  const sel = recipe?.alternativeSelections?.find((s) => s.groupId === menu.groupId);
  if (!sel) return null;
  const left = Math.max(8, Math.min(menu.left, window.innerWidth - 268));
  return (
    <div ref={ref} className="fixed z-[200] min-w-[160px] max-w-[260px] rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800" style={{ top: menu.top, left }}>
      {sel.label && <div className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400">{sel.label}</div>}
      {sel.options.map((o) => {
        const desc = o.description ? o.description.trim() : '';
        const label = desc ? `${o.name} (${desc})` : o.name;
        const cur = o.id === menu.current;
        return (
          <button key={o.id} type="button" onClick={() => onPick(o.id)} className={'w-full px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 ' + (cur ? 'font-semibold text-purple-600 dark:text-purple-400' : 'text-gray-800 dark:text-gray-200')}>
            {cur ? '✓ ' : ''}{label}
          </button>
        );
      })}
    </div>
  );
}

function ImportSourcesModal({
  permanentSummary,
  templateSummary,
  onFinish
}: {
  permanentSummary: { itemCount: number; recipeCount: number } | null;
  templateSummary: { itemCount: number; recipeCount: number } | null;
  onFinish: (c: { sammelliste: boolean; template: boolean }) => void;
}) {
  const [s, setS] = useState<boolean | null>(permanentSummary ? null : false);
  const [t, setT] = useState<boolean | null>(templateSummary ? null : false);
  useEffect(() => {
    if (s !== null && t !== null) onFinish({ sammelliste: s, template: t });
  }, [s, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = () => {
    setS((v) => (v === null ? false : v));
    setT((v) => (v === null ? false : v));
  };
  return (
    <div className="modal">
      <div className="modal-overlay" onClick={dismiss} />
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Einträge übernehmen?</h2>
          <button type="button" className="modal-close" onClick={dismiss}>&times;</button>
        </div>
        <div className="modal-body space-y-5">
          <p className="text-sm text-gray-700 dark:text-gray-300">Für diese Einkaufsliste können Inhalte aus vorhandenen Listen übernommen werden. Bitte entscheiden Sie für jede Quelle einzeln.</p>
          {permanentSummary && (
            <div className="space-y-3 rounded-lg border border-primary-200 bg-primary-50 p-4 dark:border-primary-700 dark:bg-primary-900/20">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sammelliste</h3>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{permanentSummary.itemCount} Artikel und {permanentSummary.recipeCount} Rezept{permanentSummary.recipeCount !== 1 ? 'e' : ''} in diese Liste übernehmen?</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Die Einträge werden von der Sammelliste entfernt.</p>
              </div>
              {s === null ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setS(true)}>Übernehmen</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setS(false)}>Nicht übernehmen</button>
                </div>
              ) : (
                <p className="text-xs font-medium text-primary-700 dark:text-primary-300">{s ? 'Wird übernommen.' : 'Nicht übernommen.'}</p>
              )}
            </div>
          )}
          {templateSummary && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-800/40">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Permanente Einkaufsliste</h3>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{templateSummary.itemCount} Artikel und {templateSummary.recipeCount} Rezept{templateSummary.recipeCount !== 1 ? 'e' : ''} hinzufügen?</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Die Einträge bleiben auf der Vorlage und können erneut verwendet werden.</p>
              </div>
              {t === null ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setT(true)}>Hinzufügen</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setT(false)}>Nicht hinzufügen</button>
                </div>
              ) : (
                <p className="text-xs font-medium text-primary-700 dark:text-primary-300">{t ? 'Wird hinzugefügt.' : 'Nicht hinzugefügt.'}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ApplyPermanentModal({
  list,
  onClose,
  onApplied
}: {
  list: ShoppingList;
  onClose: () => void;
  onApplied: (targetId: string, duplicates: string[]) => void;
}) {
  const { data: all } = useQuery({ queryKey: ['shoppingLists'], queryFn: localShoppingLists });
  const targets = (all ?? []).filter((l) => !l.isPermanent && l.id !== list.id && !PERMANENT_LIST_IDS.includes(l.id));
  const choose = async (targetId: string) => {
    if (list.permanentType === 2) {
      const res = await applyLocalGlobalTemplate(targetId);
      if (!res) {
        alert('Hinzufügen fehlgeschlagen.');
        return;
      }
      onApplied(targetId, []);
      alert('Inhalt wurde zur Einkaufsliste hinzugefügt.');
      return;
    }
    const res = await transferFromLocalPermanentList(targetId);
    if (!res) {
      alert('Übernahme fehlgeschlagen.');
      return;
    }
    onApplied(targetId, res.duplicateRecipeIds);
    if (res.duplicateRecipeIds.length === 0) alert('Einträge wurden in die Einkaufsliste übernommen.');
  };
  return (
    <SimpleModal title={list.permanentType === 2 ? 'Zu welcher Einkaufsliste hinzufügen?' : 'In welche Einkaufsliste übernehmen?'} onClose={onClose}>
      {!all ? (
        <div className="text-muted py-6 text-center">Listen werden geladen…</div>
      ) : targets.length === 0 ? (
        <p className="text-muted text-sm">Keine andere Einkaufsliste vorhanden. Erstellen Sie zuerst eine normale Einkaufsliste.</p>
      ) : (
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {targets.map((l) => {
            const ic = l.items?.length ?? 0;
            const rc = l.recipes?.length ?? 0;
            return (
              <button key={l.id} type="button" className="btn btn-secondary w-full justify-start py-3 text-left" onClick={() => choose(l.id)}>
                {`${l.title} (${ic} Artikel${rc ? `, ${rc} Rezept${rc !== 1 ? 'e' : ''}` : ''})`}
              </button>
            );
          })}
        </div>
      )}
    </SimpleModal>
  );
}

/* --------------------------------- Gruppierungsvorschläge (suggest modal) */

function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;
  const m: number[][] = [];
  for (let i = 0; i <= s2.length; i++) m[i] = [i];
  for (let j = 0; j <= s1.length; j++) m[0][j] = j;
  for (let i = 1; i <= s2.length; i++)
    for (let j = 1; j <= s1.length; j++)
      m[i][j] = s2[i - 1] === s1[j - 1] ? m[i - 1][j - 1] : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
  return 1 - m[s2.length][s1.length] / Math.max(s1.length, s2.length);
}

interface Suggestion {
  id: string;
  items: ShoppingListItem[];
  similarity: number;
}

/** Suggest manual groups by name similarity (mirrors GroupingSuggestionModal). */
function suggestGroups(items: ShoppingListItem[]): Suggestion[] {
  const THRESHOLD = 0.6;
  const out: Suggestion[] = [];
  const processed = new Set<string>();
  const sameGroup = (a: ShoppingListItem, b: ShoppingListItem) => {
    if (a.manualGroupId && b.manualGroupId) return a.manualGroupId === b.manualGroupId;
    if (!a.manualGroupId && !b.manualGroupId) return a.name.toLowerCase().trim() === b.name.toLowerCase().trim();
    return false;
  };
  for (let i = 0; i < items.length; i++) {
    if (processed.has(items[i].id)) continue;
    const group = [items[i]];
    processed.add(items[i].id);
    for (let j = i + 1; j < items.length; j++) {
      if (processed.has(items[j].id) || sameGroup(items[i], items[j])) continue;
      if (similarity(items[i].name, items[j].name) >= THRESHOLD) {
        group.push(items[j]);
        processed.add(items[j].id);
      }
    }
    if (group.length >= 2) {
      let tot = 0;
      let cnt = 0;
      for (let k = 0; k < group.length; k++)
        for (let l = k + 1; l < group.length; l++) {
          tot += similarity(group[k].name, group[l].name);
          cnt++;
        }
      out.push({ id: uidStatic(), items: group, similarity: cnt ? tot / cnt : 0 });
    }
  }
  return out;
}
const uidStatic = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function SuggestGroupingModal({
  items,
  onClose,
  onApply
}: {
  items: ShoppingListItem[];
  onClose: () => void;
  onApply: (groups: ShoppingListItem[][]) => void;
}) {
  const suggestions = useMemo(() => suggestGroups(items), [items]);
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(suggestions.map((s) => s.id)));

  const toggle = (id: string) =>
    setAccepted((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const acceptAll = () => onApply(suggestions.filter((s) => accepted.has(s.id)).map((s) => s.items));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gruppierungsvorschläge</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
        </div>

        {suggestions.length === 0 ? (
          <div className="py-8 text-center text-muted">Keine Gruppierungsvorschläge gefunden.</div>
        ) : (
          <>
            <p className="text-muted mb-4 text-sm">Vorschläge nach Namensähnlichkeit. Einzelne Vorschläge akzeptieren oder ablehnen.</p>
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {suggestions.map((s) => {
                const on = accepted.has(s.id);
                return (
                  <div key={s.id} className={'rounded-lg border p-4 ' + (on ? 'border-gray-300 dark:border-gray-600' : 'border-gray-200 opacity-50 dark:border-gray-700')}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <label className="mb-2 flex items-center gap-2">
                          <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-green-500" />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{s.items.length} Artikel</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">({Math.round(s.similarity * 100)}% Ähnlichkeit)</span>
                        </label>
                        <div className="ml-7 space-y-1">
                          {s.items.map((it) => (
                            <div key={it.id} className="text-sm text-gray-600 dark:text-gray-400">
                              <span className="font-medium">{it.name}</span>
                              {it.quantity && it.quantity.amount !== 0 && <span className="ml-1 text-gray-500">{it.quantity.amount} {it.quantity.unit}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => toggle(s.id)} title="Vorschlag ablehnen" className="text-red-600 hover:text-red-700">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={acceptAll} disabled={accepted.size === 0 || suggestions.length === 0} className="btn btn-success disabled:opacity-50">Alle akzeptieren</button>
          <button onClick={onClose} className="btn btn-secondary">Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
