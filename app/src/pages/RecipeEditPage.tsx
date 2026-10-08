import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type {
  Recipe,
  Ingredient,
  IngredientGroup,
  PreparationStep,
  PreparationGroup,
  LinkedIngredient,
  IntermediateIngredient
} from '@/types';
import { localRecipe, saveLocalRecipe, deleteLocalRecipe, localIngredients, localRecipes } from '@/lib/localData';
import { uploadRecipeImage, deleteRecipeImage } from '@/lib/recipeImages';
import { runSync } from '@/lib/syncRunner';
import { assetUrl } from '@/lib/api';
import { getAvailableUnits } from '@core/units';
import { NUTRITION_FIELDS } from '@core/nutrition';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const num = (s: string) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/* --------------------------------------------------------------- form model */

interface EditIng {
  id: string;
  name: string;
  description: string;
  amount: string;
  unit: string;
  alternativeGroupId?: string;
  isAlternativeDefault?: boolean;
  alternativeGroupLabel?: string;
  visibleWhen?: string; // option ingredient id
  productId?: string;
}
interface EditIngGroup {
  id: string;
  title: string;
  isDefault?: boolean;
  visibleWhen?: string;
  items: EditIng[];
}
interface EditStep {
  id: string;
  text: string;
  timer?: number;
  visibleWhen?: string;
  intermediates: IntermediateIngredient[];
  linked: LinkedIngredient[];
}
interface EditStepGroup {
  id: string;
  title: string;
  isDefault?: boolean;
  visibleWhen?: string;
  steps: EditStep[];
}
interface TimeEntry {
  id: string;
  label: string;
  minutes: string;
}

const isIngGroup = (x: Ingredient | IngredientGroup): x is IngredientGroup =>
  Array.isArray((x as IngredientGroup).ingredients);
const isStepGroup = (x: PreparationStep | PreparationGroup): x is PreparationGroup =>
  Array.isArray((x as PreparationGroup).steps);

function toIng(i: Ingredient): EditIng {
  return {
    id: i.id || uid(),
    name: i.name,
    description: i.description ?? '',
    amount: i.quantities?.[0]?.amount != null ? String(i.quantities[0].amount) : '',
    unit: i.quantities?.[0]?.unit ?? '',
    alternativeGroupId: i.alternativeGroupId,
    isAlternativeDefault: i.isAlternativeDefault,
    alternativeGroupLabel: i.alternativeGroupLabel,
    visibleWhen: i.visibleWhen?.optionIds?.[0],
    productId: i.productId
  };
}

function toForm(r: Recipe | null) {
  // Ungrouped (default) items are the ingredients of all title-less groups.
  const defaultItems: EditIng[] = [];
  const namedGroups: EditIngGroup[] = [];
  for (const g of r?.ingredientGroups ?? []) {
    const items = g.ingredients.filter((x): x is Ingredient => !isIngGroup(x)).map(toIng);
    if (!g.title) defaultItems.push(...items);
    else namedGroups.push({ id: g.id || uid(), title: g.title, visibleWhen: g.visibleWhen?.optionIds?.[0], items });
  }
  const groups: EditIngGroup[] = [{ id: 'default', title: '', isDefault: true, items: defaultItems }, ...namedGroups];

  const defaultSteps: EditStep[] = [];
  const namedPrep: EditStepGroup[] = [];
  for (const g of r?.preparationGroups ?? []) {
    const steps = g.steps
      .filter((x): x is PreparationStep => !isStepGroup(x))
      .map<EditStep>((s) => ({
        id: s.id || uid(),
        text: s.text,
        timer: s.timer,
        visibleWhen: s.visibleWhen?.optionIds?.[0],
        intermediates: s.intermediateIngredients ?? [],
        linked: s.linkedIngredients ?? []
      }));
    if (!g.title) defaultSteps.push(...steps);
    else namedPrep.push({ id: g.id || uid(), title: g.title, visibleWhen: g.visibleWhen?.optionIds?.[0], steps });
  }
  const prep: EditStepGroup[] = [{ id: 'default', title: '', isDefault: true, steps: defaultSteps }, ...namedPrep];

  const nutrition: Record<string, string> = {};
  for (const f of NUTRITION_FIELDS) {
    const v = (r?.metadata.nutrition as any)?.[f.key];
    nutrition[f.key] = v != null ? String(v) : '';
  }

  return {
    variantName: r?.variantName ?? '',
    isVariant: !!r?.parentRecipeId,
    title: r?.title ?? '',
    subtitle: r?.subtitle ?? '',
    description: r?.description ?? '',
    sourceUrl: r?.sourceUrl ?? '',
    category: r?.category ?? '',
    difficulty: r?.metadata.difficulty ?? '',
    servings: r?.metadata.servings != null ? String(r.metadata.servings) : '4',
    times: (r?.metadata.timeEntries ?? []).map((t) => ({ id: t.id || uid(), label: t.label, minutes: String(t.minutes) })) as TimeEntry[],
    tags: r?.tags ?? [],
    nutrition,
    groups,
    prep
  };
}

type Form = ReturnType<typeof toForm>;

/* ----------------------------------------------------------------- helpers */

const inputCls =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

const TrashIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const DragIcon = () => (
  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
  </svg>
);

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors duration-200 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- page */

export default function RecipeEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Form>(() => toForm(null));
  const [existing, setExisting] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [ingredientNames, setIngredientNames] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [linkingStep, setLinkingStep] = useState<{ groupId: string; stepId: string } | null>(null);

  useEffect(() => {
    if (isNew) {
      setForm(toForm(null));
      return;
    }
    localRecipe(id!).then((r) => {
      setExisting(r);
      setForm(toForm(r));
      setLoading(false);
    });
  }, [id, isNew]);

  // Autocomplete + category/tag suggestions derived from the local DB (offline).
  useEffect(() => {
    localIngredients()
      .then((list) => setIngredientNames(Array.from(new Set(list.map((i) => i.name).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'de'))))
      .catch(() => setIngredientNames([]));
    localRecipes()
      .then((rs) => {
        const cats = rs.map((r) => r.category).filter((c): c is string => !!c);
        setCategories(Array.from(new Set(cats)).sort((a, b) => a.localeCompare(b, 'de')));
        setTagSuggestions(Array.from(new Set(rs.flatMap((r) => r.tags ?? []))).sort((a, b) => a.localeCompare(b, 'de')));
      })
      .catch(() => {});
  }, []);

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  // Every ingredient across all groups (for linking + alternative option lists).
  const allIngredients = useMemo(() => form.groups.flatMap((g) => g.items), [form.groups]);
  const altOptions = useMemo(() => allIngredients.filter((i) => i.alternativeGroupId), [allIngredients]);
  const altGroups = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of allIngredients) if (i.alternativeGroupId) map.set(i.alternativeGroupId, i.alternativeGroupLabel || i.alternativeGroupId);
    return Array.from(map.entries());
  }, [allIngredients]);

  /* ---- ingredient group / item mutations ---- */
  const setGroups = (updater: (gs: EditIngGroup[]) => EditIngGroup[]) => setForm((f) => ({ ...f, groups: updater(f.groups) }));
  const updItem = (gid: string, iid: string, p: Partial<EditIng>) =>
    setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, items: g.items.map((it) => (it.id === iid ? { ...it, ...p } : it)) } : g)));
  const addItem = (gid: string) =>
    setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, items: [...g.items, { id: uid(), name: '', description: '', amount: '', unit: '' }] } : g)));
  const removeItem = (gid: string, iid: string) =>
    setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, items: g.items.filter((it) => it.id !== iid) } : g)));
  const addIngGroup = () => setGroups((gs) => [...gs, { id: uid(), title: '', items: [] }]);
  const removeIngGroup = (gid: string) => setGroups((gs) => gs.filter((g) => g.id !== gid));
  const updIngGroup = (gid: string, p: Partial<EditIngGroup>) => setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, ...p } : g)));

  /* ---- preparation group / step mutations ---- */
  const setPrep = (updater: (gs: EditStepGroup[]) => EditStepGroup[]) => setForm((f) => ({ ...f, prep: updater(f.prep) }));
  const updStep = (gid: string, sid: string, p: Partial<EditStep>) =>
    setPrep((gs) => gs.map((g) => (g.id === gid ? { ...g, steps: g.steps.map((s) => (s.id === sid ? { ...s, ...p } : s)) } : g)));
  const addStep = (gid: string) =>
    setPrep((gs) => gs.map((g) => (g.id === gid ? { ...g, steps: [...g.steps, { id: uid(), text: '', intermediates: [], linked: [] }] } : g)));
  const removeStep = (gid: string, sid: string) =>
    setPrep((gs) => gs.map((g) => (g.id === gid ? { ...g, steps: g.steps.filter((s) => s.id !== sid) } : g)));
  const addPrepGroup = () => setPrep((gs) => [...gs, { id: uid(), title: '', steps: [] }]);
  const removePrepGroup = (gid: string) => setPrep((gs) => gs.filter((g) => g.id !== gid));
  const updPrepGroup = (gid: string, p: Partial<EditStepGroup>) => setPrep((gs) => gs.map((g) => (g.id === gid ? { ...g, ...p } : g)));

  /* ---- auto-link: match ingredient names inside a step's text ---- */
  const autoLink = (gid: string, sid: string) => {
    const step = form.prep.find((g) => g.id === gid)?.steps.find((s) => s.id === sid);
    if (!step) return;
    const text = step.text.toLowerCase();
    const links: LinkedIngredient[] = [];
    for (const ing of allIngredients) {
      if (ing.name.trim() && text.includes(ing.name.trim().toLowerCase())) {
        links.push({ ingredientId: ing.id, selectedQuantityIndex: 0 });
      }
    }
    updStep(gid, sid, { linked: links });
  };

  /* ---- drag reordering within a list (ingredients / steps) ---- */
  const dragRef = useRef<{ kind: 'ing' | 'prep'; gid: string; id: string } | null>(null);
  const onDropItem = (kind: 'ing' | 'prep', targetGid: string, targetId: string | null) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.kind !== kind) return;
    if (kind === 'ing') {
      setGroups((gs) => moveInto(gs, d.gid, d.id, targetGid, targetId, 'items'));
    } else {
      setPrep((gs) => moveInto(gs, d.gid, d.id, targetGid, targetId, 'steps'));
    }
  };

  /* ---------------------------------------------------------------- save */
  const save = async () => {
    if (!form.title.trim()) return setError('Titel ist ein Pflichtfeld.');
    if (!form.category.trim()) return setError('Kategorie ist ein Pflichtfeld.');
    setBusy(true);
    setError(null);
    try {
      const ingredientGroups: IngredientGroup[] = form.groups
        .map((g) => ({
          id: g.isDefault ? uid() : g.id,
          title: g.isDefault ? undefined : g.title.trim() || undefined,
          visibleWhen: g.visibleWhen ? { optionIds: [g.visibleWhen] } : undefined,
          ingredients: g.items
            .filter((i) => i.name.trim())
            .map<Ingredient>((i) => ({
              id: i.id,
              name: i.name.trim(),
              description: i.description.trim() || undefined,
              quantities: [{ amount: num(i.amount), unit: i.unit.trim() }],
              alternativeGroupId: i.alternativeGroupId || undefined,
              isAlternativeDefault: i.isAlternativeDefault || undefined,
              alternativeGroupLabel: i.alternativeGroupLabel || undefined,
              visibleWhen: i.visibleWhen ? { optionIds: [i.visibleWhen] } : undefined,
              productId: i.productId || undefined
            }))
        }))
        .filter((g) => g.ingredients.length > 0 || g.title);

      const preparationGroups: PreparationGroup[] = form.prep
        .map((g) => ({
          id: g.isDefault ? uid() : g.id,
          title: g.isDefault ? undefined : g.title.trim() || undefined,
          visibleWhen: g.visibleWhen ? { optionIds: [g.visibleWhen] } : undefined,
          steps: g.steps
            .filter((s) => s.text.trim())
            .map<PreparationStep>((s) => ({
              id: s.id,
              text: s.text.trim(),
              timer: s.timer,
              visibleWhen: s.visibleWhen ? { optionIds: [s.visibleWhen] } : undefined,
              linkedIngredients: s.linked,
              intermediateIngredients: s.intermediates
            }))
        }))
        .filter((g) => g.steps.length > 0 || g.title);

      const nutrition: Record<string, number> = {};
      let anyNut = false;
      for (const f of NUTRITION_FIELDS) {
        const v = form.nutrition[f.key];
        if (v.trim() !== '') {
          nutrition[f.key] = num(v);
          anyNut = true;
        }
      }

      const data: any = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || undefined,
        description: form.description.trim() || undefined,
        sourceUrl: form.sourceUrl.trim() || undefined,
        category: form.category.trim(),
        tags: form.tags,
        variantName: form.isVariant ? form.variantName.trim() || undefined : undefined,
        ingredientGroups,
        preparationGroups,
        metadata: {
          servings: num(form.servings) || 1,
          difficulty: (form.difficulty || undefined) as any,
          timeEntries: form.times
            .filter((t) => t.label.trim() && num(t.minutes) > 0)
            .map((t) => ({ id: t.id, label: t.label.trim(), minutes: num(t.minutes) })),
          nutrition: anyNut ? nutrition : existing?.metadata.nutrition
        }
      };
      const saved = await saveLocalRecipe(isNew ? null : id!, data);
      queryClient.invalidateQueries();
      navigate(`/rezept/${saved.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id || !confirm(`Rezept "${form.title}" löschen?`)) return;
    setBusy(true);
    await deleteLocalRecipe(id);
    queryClient.invalidateQueries();
    navigate('/rezepte');
  };

  const refreshImages = async () => {
    if (!id) return;
    await runSync();
    const r = await localRecipe(id);
    setExisting(r);
    queryClient.invalidateQueries({ queryKey: ['recipe', id] });
  };
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !id) return;
    setImgBusy(true);
    setImgError(null);
    try {
      await uploadRecipeImage(id, file);
      await refreshImages();
    } catch (err) {
      setImgError((err as Error).message);
    } finally {
      setImgBusy(false);
    }
  };
  const removeImage = async (imageId: string) => {
    if (!id) return;
    setImgBusy(true);
    setImgError(null);
    try {
      await deleteRecipeImage(id, imageId);
      await refreshImages();
    } catch (err) {
      setImgError((err as Error).message);
    } finally {
      setImgBusy(false);
    }
  };

  if (loading) return <p className="text-gray-500">Lade …</p>;

  const linkingStepObj = linkingStep
    ? form.prep.find((g) => g.id === linkingStep.groupId)?.steps.find((s) => s.id === linkingStep.stepId)
    : null;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">{isNew ? 'Neues Rezept' : 'Rezept bearbeiten'}</h1>

      <div className="space-y-6">
        {/* Grundinformationen */}
        <Card>
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">Grundinformationen bearbeiten</h2>
          <div className="space-y-4">
            {form.isVariant && (
              <div>
                <label className={labelCls}>Varianten-Tab Name</label>
                <input className={inputCls} value={form.variantName} placeholder="z.B. Vegan, Scharf, Ohne Zwiebeln" onChange={(e) => patch({ variantName: e.target.value })} />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Dieser Name wird im Varianten-Tab angezeigt.</p>
              </div>
            )}
            <div>
              <label className={labelCls}>Titel <span className="text-red-500">*</span></label>
              <input className={inputCls} value={form.title} onChange={(e) => patch({ title: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Untertitel</label>
              <input className={inputCls} value={form.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Beschreibung</label>
              <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => patch({ description: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Quell-URL (optional)</label>
              <input className={inputCls} type="url" value={form.sourceUrl} placeholder="https://example.com/recipe" onChange={(e) => patch({ sourceUrl: e.target.value })} />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">URL der Quelle, von der das Rezept importiert wurde (z.B. YouTube, Kochblog, etc.)</p>
            </div>
            <div>
              <label className={labelCls}>Portionen <span className="text-red-500">*</span></label>
              <input className={inputCls} type="number" min={1} step={1} value={form.servings} onChange={(e) => patch({ servings: e.target.value })} />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Zeitangaben</label>
                <button type="button" onClick={() => patch({ times: [...form.times, { id: uid(), label: '', minutes: '30' }] })} className="rounded bg-blue-500 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-600">
                  + Zeit hinzufügen
                </button>
              </div>
              <div className="space-y-3">
                {form.times.map((t, i) => (
                  <div key={t.id} className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className={labelCls}>Bezeichnung</label>
                      <input className={inputCls} value={t.label} placeholder="z.B. Kochzeit, Backzeit, Ruhezeit" onChange={(e) => patch({ times: form.times.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    </div>
                    <div className="w-24">
                      <label className={labelCls}>Minuten</label>
                      <input className={inputCls} type="number" min={1} value={t.minutes} onChange={(e) => patch({ times: form.times.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)) })} />
                    </div>
                    <button type="button" onClick={() => patch({ times: form.times.filter((_, j) => j !== i) })} className="rounded bg-red-500 px-3 py-2 text-white transition-colors hover:bg-red-600" title="Entfernen">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Schwierigkeit</label>
              <select className={inputCls} value={form.difficulty} onChange={(e) => patch({ difficulty: e.target.value })}>
                <option value="">Wählen...</option>
                <option value="leicht">Leicht</option>
                <option value="mittel">Mittel</option>
                <option value="schwer">Schwer</option>
              </select>
            </div>

            {/* Nutrition per portion */}
            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-600">
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">Nährwerte pro Portion (optional)</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {NUTRITION_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className={labelCls}>{f.editLabel}</label>
                    <input
                      className={inputCls}
                      type="number"
                      min={0}
                      step={f.step}
                      value={form.nutrition[f.key]}
                      placeholder={f.placeholder}
                      onChange={(e) => patch({ nutrition: { ...form.nutrition, [f.key]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Kategorie & Tags */}
        <Card>
          <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Kategorie &amp; Tags</h3>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Kategorie <span className="text-red-500">*</span></label>
              <input
                className={inputCls}
                list="category-list"
                value={form.category}
                placeholder="Kategorie wählen oder eingeben …"
                onChange={(e) => patch({ category: e.target.value })}
              />
              <datalist id="category-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls}>Tags</label>
              <div className="flex min-h-[2.5rem] flex-wrap items-center gap-2 rounded-md border border-gray-300 bg-gray-50 p-2 dark:border-gray-600 dark:bg-gray-700">
                {form.category && (
                  <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-800 dark:bg-orange-900/50 dark:text-orange-200">{form.category}</span>
                )}
                {form.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-3 py-1 text-sm text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                    {t}
                    <button type="button" onClick={() => patch({ tags: form.tags.filter((x) => x !== t) })} className="text-gray-500 hover:text-red-500">×</button>
                  </span>
                ))}
                <TagAdder existing={form.tags} suggestions={tagSuggestions} onAdd={(t) => patch({ tags: [...form.tags, t] })} />
              </div>
            </div>
          </div>
        </Card>

        {/* Bilder */}
        {!isNew && (
          <Card>
            <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">Bilder</h2>
            <div className="flex flex-wrap gap-3">
              {(existing?.images ?? []).map((img) => (
                <div key={img.id} className="relative h-24 w-24 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                  <img src={assetUrl(img.url)} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removeImage(img.id)} disabled={imgBusy} aria-label="Bild löschen" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80 disabled:opacity-50">
                    ✕
                  </button>
                </div>
              ))}
              <label className={'flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-center text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 ' + (imgBusy ? 'pointer-events-none opacity-50' : '')}>
                <span className="text-lg">＋</span>
                {imgBusy ? 'Lädt …' : 'Bild'}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickImage} />
              </label>
            </div>
            {imgError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{imgError}</p>}
          </Card>
        )}

        {/* Zutaten */}
        <Card>
          <div className="mb-4 flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Zutaten bearbeiten</h2>
            <div className="flex flex-col space-y-2 sm:flex-row sm:space-x-2 sm:space-y-0">
              <button type="button" onClick={addIngGroup} className="rounded bg-blue-500 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600">+ Gruppe hinzufügen</button>
              <button type="button" onClick={() => addItem(form.groups[0].id)} className="rounded bg-orange-500 px-3 py-2 text-sm text-white transition-colors hover:bg-orange-600">+ Zutat hinzufügen</button>
            </div>
          </div>
          <datalist id="ingredient-names">{ingredientNames.map((n) => <option key={n} value={n} />)}</datalist>

          <div className="space-y-6">
            {form.groups.map((g) => (
              <div
                key={g.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropItem('ing', g.id, null)}
                className="rounded-lg border border-gray-300 bg-gray-50 p-3 transition-colors duration-200 sm:p-4 dark:border-gray-600 dark:bg-gray-700/50"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  {g.isDefault ? (
                    <div className="flex-1 px-3 py-2 text-base font-medium text-gray-600 sm:text-lg dark:text-gray-300">Zutaten (ungruppiert)</div>
                  ) : (
                    <>
                      <input className="group-title-input flex-1 border-b border-gray-300 bg-transparent px-3 py-2 text-base font-medium text-gray-900 focus:border-orange-500 focus:outline-none sm:text-lg dark:border-gray-600 dark:text-white" value={g.title} placeholder="Gruppenname (optional)" onChange={(e) => updIngGroup(g.id, { title: e.target.value })} />
                      <button type="button" onClick={() => removeIngGroup(g.id)} className="p-1 text-red-600 hover:text-red-700 dark:text-red-400"><TrashIcon /></button>
                    </>
                  )}
                </div>
                {!g.isDefault && altOptions.length > 0 && (
                  <DependencyControl value={g.visibleWhen} options={altOptions} onChange={(v) => updIngGroup(g.id, { visibleWhen: v })} />
                )}

                <div className="space-y-3">
                  {g.items.map((it) => (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={() => (dragRef.current = { kind: 'ing', gid: g.id, id: it.id })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.stopPropagation();
                        onDropItem('ing', g.id, it.id);
                      }}
                      className="rounded-md border border-gray-200 bg-white p-3 transition-colors duration-200 dark:border-gray-600 dark:bg-gray-800"
                    >
                      <div className="space-y-3">
                        <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-3 sm:space-y-0">
                          <div className="mr-2 cursor-move text-gray-400 hover:text-gray-600 dark:text-gray-500"><DragIcon /></div>
                          <div className="relative flex-1">
                            <input list="ingredient-names" className={inputCls} value={it.name} placeholder="Zutatename" onChange={(e) => updItem(g.id, it.id, { name: e.target.value })} />
                          </div>
                          <div className="flex space-x-2 sm:space-x-3">
                            <input className={inputCls + ' w-20 sm:w-24'} type="number" step="0.1" value={it.amount} placeholder="Menge" onChange={(e) => updItem(g.id, it.id, { amount: e.target.value })} />
                            <UnitSelect value={it.unit} onChange={(v) => updItem(g.id, it.id, { unit: v })} />
                            <button type="button" onClick={() => removeItem(g.id, it.id)} className="px-2 py-2 text-red-600 hover:text-red-700 dark:text-red-400"><TrashIcon /></button>
                          </div>
                        </div>
                        <input className={inputCls + ' text-sm'} value={it.description} placeholder="Beschreibung (optional)" onChange={(e) => updItem(g.id, it.id, { description: e.target.value })} />
                        <AltControls item={it} altGroups={altGroups} altOptions={altOptions.filter((o) => o.id !== it.id)} onChange={(p) => updItem(g.id, it.id, p)} />
                      </div>
                    </div>
                  ))}
                </div>

                <button type="button" onClick={() => addItem(g.id)} className="mt-3 w-full rounded bg-gray-500 px-3 py-2 text-sm text-white transition-colors hover:bg-gray-600 sm:w-auto dark:bg-gray-600 dark:hover:bg-gray-500">
                  + Zutat zu {g.isDefault ? 'ungruppiert' : g.title || 'Gruppe'} hinzufügen
                </button>
              </div>
            ))}
          </div>
        </Card>

        {/* Zubereitung */}
        <Card>
          <div className="mb-4 flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Zubereitung bearbeiten</h2>
            <div className="flex flex-col space-y-2 sm:flex-row sm:space-x-2 sm:space-y-0">
              <button type="button" onClick={addPrepGroup} className="rounded bg-blue-500 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600">+ Gruppe hinzufügen</button>
              <button type="button" onClick={() => addStep(form.prep[0].id)} className="rounded bg-green-500 px-3 py-2 text-sm text-white transition-colors hover:bg-green-600">+ Schritt hinzufügen</button>
            </div>
          </div>

          <div className="space-y-6">
            {form.prep.map((g) => (
              <div
                key={g.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropItem('prep', g.id, null)}
                className="rounded-lg border border-gray-300 bg-gray-50 p-3 transition-colors duration-200 sm:p-4 dark:border-gray-600 dark:bg-gray-700/50"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  {g.isDefault ? (
                    <div className="flex-1 px-3 py-2 text-base font-medium text-gray-600 sm:text-lg dark:text-gray-300">Zubereitungsschritte (ungruppiert)</div>
                  ) : (
                    <>
                      <input className="flex-1 border-b border-gray-300 bg-transparent px-3 py-2 text-base font-medium text-gray-900 focus:border-green-500 focus:outline-none sm:text-lg dark:border-gray-600 dark:text-white" value={g.title} placeholder="Gruppenname (optional)" onChange={(e) => updPrepGroup(g.id, { title: e.target.value })} />
                      <button type="button" onClick={() => removePrepGroup(g.id)} className="p-1 text-red-600 hover:text-red-700 dark:text-red-400"><TrashIcon /></button>
                    </>
                  )}
                </div>
                {!g.isDefault && altOptions.length > 0 && (
                  <DependencyControl value={g.visibleWhen} options={altOptions} onChange={(v) => updPrepGroup(g.id, { visibleWhen: v })} />
                )}

                <div className="space-y-4">
                  {g.steps.map((s, si) => (
                    <StepEditor
                      key={s.id}
                      step={s}
                      index={si}
                      allIngredients={allIngredients}
                      altOptions={altOptions}
                      onDragStart={() => (dragRef.current = { kind: 'prep', gid: g.id, id: s.id })}
                      onDrop={() => onDropItem('prep', g.id, s.id)}
                      onChange={(p) => updStep(g.id, s.id, p)}
                      onRemove={() => removeStep(g.id, s.id)}
                      onAutoLink={() => autoLink(g.id, s.id)}
                      onManualLink={() => setLinkingStep({ groupId: g.id, stepId: s.id })}
                    />
                  ))}
                </div>

                <button type="button" onClick={() => addStep(g.id)} className="mt-3 w-full rounded bg-gray-500 px-3 py-2 text-sm text-white transition-colors hover:bg-gray-600 sm:w-auto dark:bg-gray-600 dark:hover:bg-gray-500">
                  + Schritt zu {g.isDefault ? 'ungruppiert' : g.title || 'Gruppe'} hinzufügen
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-8 flex items-center justify-between gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        {!isNew ? (
          <button onClick={remove} disabled={busy} className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400">Löschen</button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button onClick={() => navigate(isNew ? '/' : `/rezept/${id}`)} disabled={busy} className="rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-600">Abbrechen</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">Speichern</button>
        </div>
      </div>

      {linkingStep && linkingStepObj && (
        <ManualLinkModal
          step={linkingStepObj}
          groups={form.prep}
          currentStepId={linkingStep.stepId}
          allIngredients={allIngredients}
          onClose={() => setLinkingStep(null)}
          onSave={(linked) => {
            updStep(linkingStep.groupId, linkingStep.stepId, { linked });
            setLinkingStep(null);
          }}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- sub-components */

function moveInto<T extends { id: string }>(
  groups: (T & Record<string, any>)[],
  fromGid: string,
  itemId: string,
  toGid: string,
  targetId: string | null,
  key: 'items' | 'steps'
) {
  let moved: any = null;
  const stripped = groups.map((g) => {
    if (g.id !== fromGid) return g;
    const list = (g as any)[key] as any[];
    moved = list.find((x) => x.id === itemId);
    return { ...g, [key]: list.filter((x) => x.id !== itemId) };
  });
  if (!moved) return groups;
  return stripped.map((g) => {
    if (g.id !== toGid) return g;
    const list = [...((g as any)[key] as any[])];
    const idx = targetId ? list.findIndex((x) => x.id === targetId) : list.length;
    list.splice(idx === -1 ? list.length : idx, 0, moved);
    return { ...g, [key]: list };
  });
}

function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const units = useMemo(() => getAvailableUnits(), []);
  const known = units.some((u) => u.name === value);
  return (
    <select
      className="ingredient-unit-select w-20 rounded-md border border-gray-300 bg-white px-2 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 sm:w-24 sm:px-3 sm:text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Einheit</option>
      {!known && value && <option value={value}>{value}</option>}
      {units.map((u) => (
        <option key={u.name} value={u.name}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

function DependencyControl({ value, options, onChange }: { value?: string; options: EditIng[]; onChange: (v: string | undefined) => void }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Nur anzeigen wenn (Abhängigkeit)</label>
      <select
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">— immer —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name || o.id}</option>
        ))}
      </select>
    </div>
  );
}

function AltControls({
  item,
  altGroups,
  altOptions,
  onChange
}: {
  item: EditIng;
  altGroups: [string, string][];
  altOptions: EditIng[];
  onChange: (p: Partial<EditIng>) => void;
}) {
  const [open, setOpen] = useState(!!item.alternativeGroupId || !!item.visibleWhen);
  const inputClass = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-orange-500';
  const hasGroup = !!item.alternativeGroupId;
  return (
    <details className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-600" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none text-xs text-gray-500 dark:text-gray-400">Alternative &amp; Abhängigkeit</summary>
      <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-gray-600 dark:text-gray-400">Alternativ-Gruppe</span>
          <select
            className={inputClass}
            value={item.alternativeGroupId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ alternativeGroupId: v === '__new__' ? uid() : v || undefined });
            }}
          >
            <option value="">— keine —</option>
            {altGroups.map(([gid, label]) => (
              <option key={gid} value={gid}>{label}</option>
            ))}
            <option value="__new__">+ neue Gruppe</option>
          </select>
        </label>
        {hasGroup && (
          <label className="flex flex-col gap-1">
            <span className="text-gray-600 dark:text-gray-400">Standard-Alternative</span>
            <span className="flex items-center gap-1">
              <input type="checkbox" checked={!!item.isAlternativeDefault} onChange={(e) => onChange({ isAlternativeDefault: e.target.checked })} />
              <span className="text-gray-500 dark:text-gray-400">als Standard anzeigen</span>
            </span>
          </label>
        )}
        {hasGroup && (
          <label className="flex flex-col gap-1">
            <span className="text-gray-600 dark:text-gray-400">Bezeichnung der Gruppe</span>
            <input type="text" className={inputClass} value={item.alternativeGroupLabel ?? ''} placeholder="z.B. Mehl-Variante" onChange={(e) => onChange({ alternativeGroupLabel: e.target.value })} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-gray-600 dark:text-gray-400">Nur anzeigen wenn</span>
          <select className={inputClass} value={item.visibleWhen ?? ''} onChange={(e) => onChange({ visibleWhen: e.target.value || undefined })}>
            <option value="">— immer —</option>
            {altOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name || o.id}</option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}

function TagAdder({ existing, suggestions, onAdd }: { existing: string[]; suggestions: string[]; onAdd: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const matches = val.trim() ? suggestions.filter((s) => s.toLowerCase().includes(val.toLowerCase()) && !existing.includes(s)).slice(0, 8) : [];
  const commit = (t: string) => {
    const v = t.trim();
    if (v && !existing.includes(v)) onAdd(v);
    setVal('');
    setOpen(false);
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} title="Tag hinzufügen" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300 dark:hover:bg-gray-500">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
      </button>
    );
  return (
    <span className="relative">
      <input
        autoFocus
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        value={val}
        placeholder="Tag eingeben..."
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(val);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {matches.length > 0 && (
        <div className="absolute left-0 top-full z-10 mt-1 max-h-40 w-48 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {matches.map((m) => (
            <button key={m} type="button" onMouseDown={() => commit(m)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">{m}</button>
          ))}
        </div>
      )}
    </span>
  );
}

function StepEditor({
  step,
  index,
  allIngredients,
  altOptions,
  onDragStart,
  onDrop,
  onChange,
  onRemove,
  onAutoLink,
  onManualLink
}: {
  step: EditStep;
  index: number;
  allIngredients: EditIng[];
  altOptions: EditIng[];
  onDragStart: () => void;
  onDrop: () => void;
  onChange: (p: Partial<EditStep>) => void;
  onRemove: () => void;
  onAutoLink: () => void;
  onManualLink: () => void;
}) {
  const addIntermediate = () => onChange({ intermediates: [...step.intermediates, { id: uid(), name: '', description: '' }] });
  const updIntermediate = (iid: string, p: Partial<IntermediateIngredient>) =>
    onChange({ intermediates: step.intermediates.map((x) => (x.id === iid ? { ...x, ...p } : x)) });
  const removeIntermediate = (iid: string) => onChange({ intermediates: step.intermediates.filter((x) => x.id !== iid) });

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop();
      }}
      className="rounded-md border border-gray-200 bg-white p-3 transition-colors duration-200 sm:p-4 dark:border-gray-600 dark:bg-gray-800"
    >
      <div className="flex flex-col space-y-3 sm:flex-row sm:items-start sm:space-x-3 sm:space-y-0">
        <div className="flex items-center space-x-2 sm:flex-col sm:space-x-0 sm:space-y-2">
          <div className="cursor-move text-gray-400 hover:text-gray-600 dark:text-gray-500"><DragIcon /></div>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">{index + 1}</div>
        </div>
        <div className="flex-1 space-y-3">
          <textarea className={inputCls} rows={3} placeholder="Zubereitungsschritt..." value={step.text} onChange={(e) => onChange({ text: e.target.value })} />

          {/* Intermediate ingredients */}
          <div className="border-t border-gray-200 pt-3 dark:border-gray-600">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Zwischenzutaten</h4>
              <button type="button" onClick={addIntermediate} className="rounded bg-teal-500 px-2 py-1 text-xs text-white transition-colors hover:bg-teal-600" title="Zwischenzutat hinzufügen">+ Zwischenzutat</button>
            </div>
            <div className="space-y-2">
              {step.intermediates.map((it) => (
                <div key={it.id} className="flex flex-col space-y-3 rounded border bg-teal-50 p-3 dark:bg-teal-900/20">
                  <input className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" value={it.name} placeholder="Name der Zwischenzutat" onChange={(e) => updIntermediate(it.id, { name: e.target.value })} />
                  <div className="flex flex-col space-y-2 sm:flex-row sm:space-x-2 sm:space-y-0">
                    <input className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" value={it.description ?? ''} placeholder="Beschreibung (optional)" onChange={(e) => updIntermediate(it.id, { description: e.target.value })} />
                    <button type="button" onClick={() => removeIntermediate(it.id)} className="self-start rounded-md px-3 py-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"><TrashIcon /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Linked ingredients display */}
          {step.linked.length > 0 && (
            <div className="flex flex-wrap gap-1 sm:gap-2">
              {step.linked.map((link, li) => {
                const ing = allIngredients.find((x) => x.id === link.ingredientId);
                const label = ing ? `${ing.name} (${ing.amount} ${ing.unit})` : link.isIntermediate ? 'Zwischenzutat' : link.ingredientId;
                return (
                  <span key={li} className={'inline-flex items-center gap-1 break-words rounded-full px-2 py-1 text-xs font-medium ' + (link.isIntermediate ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200')}>
                    {label}
                    <button type="button" onClick={() => onChange({ linked: step.linked.filter((_, j) => j !== li) })} className="hover:text-red-600">×</button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Link buttons */}
          <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <div className="flex flex-col space-y-2 sm:flex-row sm:space-x-2 sm:space-y-0">
              <button type="button" onClick={onAutoLink} className="flex items-center justify-center space-x-1 rounded bg-purple-500 px-3 py-1 text-xs text-white transition-colors hover:bg-purple-600" title="Zutaten automatisch verlinken">
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                <span>Auto-Link</span>
              </button>
              <button type="button" onClick={onManualLink} className="flex items-center justify-center space-x-1 rounded bg-indigo-500 px-3 py-1 text-xs text-white transition-colors hover:bg-indigo-600" title="Zutaten manuell verlinken">
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                <span>Manual-Link</span>
              </button>
            </div>
            <button type="button" onClick={onRemove} className="self-end p-1 text-red-600 hover:text-red-700 dark:text-red-400"><TrashIcon /></button>
          </div>

          {/* Per-step dependency ("Nur anzeigen wenn") — only when alternatives exist */}
          {altOptions.length > 0 && (
            <label className="flex items-center gap-2 pt-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Nur anzeigen wenn</span>
              <select
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                value={step.visibleWhen ?? ''}
                onChange={(e) => onChange({ visibleWhen: e.target.value || undefined })}
              >
                <option value="">— immer —</option>
                {altOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name || o.id}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualLinkModal({
  step,
  groups,
  currentStepId,
  allIngredients,
  onClose,
  onSave
}: {
  step: EditStep;
  groups: EditStepGroup[];
  currentStepId: string;
  allIngredients: EditIng[];
  onClose: () => void;
  onSave: (linked: LinkedIngredient[]) => void;
}) {
  // Intermediate ingredients defined in this and previous steps.
  const flatSteps = groups.flatMap((g) => g.steps);
  const stepIdx = flatSteps.findIndex((s) => s.id === currentStepId);
  const intermediates = flatSteps.slice(0, stepIdx + 1).flatMap((s) => s.intermediates);

  const [sel, setSel] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const l of step.linked) m.set(l.ingredientId, l.selectedQuantityIndex);
    return m;
  });
  const intermediateIds = new Set(intermediates.map((i) => i.id));
  const toggle = (id: string) => setSel((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, 0); return n; });

  const commit = () => {
    const linked: LinkedIngredient[] = Array.from(sel.entries()).map(([ingredientId, qi]) => ({
      ingredientId,
      selectedQuantityIndex: qi,
      isIntermediate: intermediateIds.has(ingredientId) || undefined
    }));
    onSave(linked);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Zutaten verlinken</h3>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300">&times;</button>
        </div>
        <div className="space-y-2">
          {allIngredients.filter((i) => i.name.trim()).map((ing) => (
            <label key={ing.id} className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm dark:border-gray-700">
              <input type="checkbox" checked={sel.has(ing.id)} onChange={() => toggle(ing.id)} />
              <span className="flex-1 text-gray-800 dark:text-gray-100">{ing.name}</span>
              <span className="text-xs text-gray-500">{ing.amount} {ing.unit}</span>
            </label>
          ))}
          {intermediates.length > 0 && (
            <>
              <p className="pt-2 text-xs font-medium text-purple-600 dark:text-purple-300">Zwischenzutaten</p>
              {intermediates.filter((i) => i.name.trim()).map((it) => (
                <label key={it.id} className="flex items-center gap-2 rounded border border-purple-200 bg-purple-50 p-2 text-sm dark:border-purple-800 dark:bg-purple-900/20">
                  <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} />
                  <span className="flex-1 text-gray-800 dark:text-gray-100">{it.name}</span>
                  <span className="text-xs text-purple-500">Zwischenzutat</span>
                </label>
              ))}
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-600">Abbrechen</button>
          <button onClick={commit} className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600">Übernehmen</button>
        </div>
      </div>
    </div>
  );
}
