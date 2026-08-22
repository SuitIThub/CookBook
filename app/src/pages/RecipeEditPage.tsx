import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Recipe, Ingredient, IngredientGroup, PreparationStep, PreparationGroup } from '@/types';
import { localRecipe, saveLocalRecipe, deleteLocalRecipe, localIngredients } from '@/lib/localData';
import { uploadRecipeImage, deleteRecipeImage } from '@/lib/recipeImages';
import { runSync } from '@/lib/syncRunner';
import { assetUrl } from '@/lib/api';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

interface EditIng { id: string; name: string; amount: string; unit: string }
interface EditIngGroup { id: string; title: string; items: EditIng[] }
interface EditStep { id: string; text: string }
interface EditStepGroup { id: string; title: string; steps: EditStep[] }
interface TimeEntry { id: string; label: string; minutes: string }

const isIngGroup = (x: Ingredient | IngredientGroup): x is IngredientGroup =>
  Array.isArray((x as IngredientGroup).ingredients);
const isStepGroup = (x: PreparationStep | PreparationGroup): x is PreparationGroup =>
  Array.isArray((x as PreparationGroup).steps);

/** Recipe → editable form (flattens one level; nested groups/alternatives simplified for v1). */
function toForm(r: Recipe | null) {
  const groups: EditIngGroup[] = (r?.ingredientGroups ?? []).map((g) => ({
    id: g.id || uid(),
    title: g.title ?? '',
    items: g.ingredients.filter((x): x is Ingredient => !isIngGroup(x)).map((i) => ({
      id: i.id || uid(),
      name: i.name,
      amount: i.quantities?.[0]?.amount != null ? String(i.quantities[0].amount) : '',
      unit: i.quantities?.[0]?.unit ?? ''
    }))
  }));
  const prep: EditStepGroup[] = (r?.preparationGroups ?? []).map((g) => ({
    id: g.id || uid(),
    title: g.title ?? '',
    steps: g.steps.filter((x): x is PreparationStep => !isStepGroup(x)).map((s) => ({ id: s.id || uid(), text: s.text }))
  }));
  return {
    title: r?.title ?? '',
    subtitle: r?.subtitle ?? '',
    description: r?.description ?? '',
    category: r?.category ?? '',
    difficulty: r?.metadata.difficulty ?? '',
    servings: r?.metadata.servings != null ? String(r.metadata.servings) : '4',
    times: (r?.metadata.timeEntries ?? []).map((t) => ({ id: uid(), label: t.label, minutes: String(t.minutes) })) as TimeEntry[],
    tags: r?.tags ?? [],
    groups: groups.length ? groups : [{ id: uid(), title: '', items: [] }],
    prep: prep.length ? prep : [{ id: uid(), title: '', steps: [] }]
  };
}

const num = (s: string) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export default function RecipeEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(() => toForm(null));
  const [existing, setExisting] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [ingredientNames, setIngredientNames] = useState<string[]>([]);

  useEffect(() => {
    if (isNew) return;
    localRecipe(id!).then((r) => {
      setExisting(r);
      setForm(toForm(r));
      setLoading(false);
    });
  }, [id, isNew]);

  // Ingredient-name autocomplete from the local catalogue (offline).
  useEffect(() => {
    localIngredients()
      .then((list) => {
        const names = Array.from(new Set(list.map((i) => i.name).filter(Boolean))).sort((a, b) =>
          a.localeCompare(b, 'de')
        );
        setIngredientNames(names);
      })
      .catch(() => setIngredientNames([]));
  }, []);

  const patch = (p: Partial<ReturnType<typeof toForm>>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    if (!form.title.trim()) {
      setError('Titel ist erforderlich.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ingredientGroups: IngredientGroup[] = form.groups.map((g) => ({
        id: g.id,
        title: g.title.trim() || undefined,
        ingredients: g.items
          .filter((i) => i.name.trim())
          .map<Ingredient>((i) => ({
            id: i.id,
            name: i.name.trim(),
            quantities: [{ amount: num(i.amount), unit: i.unit.trim() }]
          }))
      }));
      const preparationGroups: PreparationGroup[] = form.prep.map((g) => ({
        id: g.id,
        title: g.title.trim() || undefined,
        steps: g.steps
          .filter((s) => s.text.trim())
          .map<PreparationStep>((s) => ({ id: s.id, text: s.text.trim(), linkedIngredients: [], intermediateIngredients: [] }))
      }));
      const data: any = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || undefined,
        description: form.description.trim() || undefined,
        category: form.category.trim() || undefined,
        tags: form.tags,
        ingredientGroups,
        preparationGroups,
        metadata: {
          servings: num(form.servings) || 1,
          difficulty: (form.difficulty || undefined) as any,
          timeEntries: form.times
            .filter((t) => t.label.trim())
            .map((t) => ({ id: t.id, label: t.label.trim(), minutes: num(t.minutes) })),
          nutrition: existing?.metadata.nutrition
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
    navigate('/');
  };

  // Images live as files on the server; upload/delete is online-only, then we
  // re-sync so the local replica reflects the recipe's updated images[].
  const refreshImages = async () => {
    if (!id) return;
    await runSync();
    const r = await localRecipe(id);
    setExisting(r);
    queryClient.invalidateQueries({ queryKey: ['recipe', id] });
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
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

  const field =
    'w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-800 dark:text-white';
  const sec = 'mt-8';
  const h2 = 'mb-3 text-xl font-semibold';

  if (loading) return <p className="text-secondary-500">Lade …</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">{isNew ? 'Neues Rezept' : 'Rezept bearbeiten'}</h1>

      <div className="space-y-3">
        <input className={field} placeholder="Titel *" value={form.title} onChange={(e) => patch({ title: e.target.value })} />
        <input className={field} placeholder="Untertitel" value={form.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
        <textarea className={field} placeholder="Beschreibung" rows={2} value={form.description} onChange={(e) => patch({ description: e.target.value })} />
        <div className="grid grid-cols-3 gap-3">
          <input className={field} placeholder="Kategorie" value={form.category} onChange={(e) => patch({ category: e.target.value })} />
          <select className={field} value={form.difficulty} onChange={(e) => patch({ difficulty: e.target.value })}>
            <option value="">Schwierigkeit</option>
            <option value="leicht">leicht</option>
            <option value="mittel">mittel</option>
            <option value="schwer">schwer</option>
          </select>
          <input className={field} placeholder="Portionen" inputMode="numeric" value={form.servings} onChange={(e) => patch({ servings: e.target.value })} />
        </div>
      </div>

      {/* Times */}
      <section className={sec}>
        <h2 className={h2}>Zeiten</h2>
        {form.times.map((t, i) => (
          <div key={t.id} className="mb-2 flex gap-2">
            <input className={field + ' flex-1'} placeholder="z. B. Kochzeit" value={t.label} onChange={(e) => patch({ times: form.times.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <input className={field + ' w-24'} placeholder="Min" inputMode="numeric" value={t.minutes} onChange={(e) => patch({ times: form.times.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)) })} />
            <button className="px-2 text-red-500" onClick={() => patch({ times: form.times.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="text-sm text-primary-600 hover:underline" onClick={() => patch({ times: [...form.times, { id: uid(), label: '', minutes: '' }] })}>+ Zeit</button>
      </section>

      {/* Tags */}
      <section className={sec}>
        <h2 className={h2}>Tags</h2>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {form.tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full bg-secondary-100 px-2 py-0.5 text-xs dark:bg-secondary-700">
              {t}
              <button className="text-secondary-400" onClick={() => patch({ tags: form.tags.filter((x) => x !== t) })}>✕</button>
            </span>
          ))}
        </div>
        <input
          className={field}
          placeholder="Tag hinzufügen (Enter)"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              e.preventDefault();
              if (!form.tags.includes(tagInput.trim())) patch({ tags: [...form.tags, tagInput.trim()] });
              setTagInput('');
            }
          }}
        />
      </section>

      {/* Images (existing recipes only — upload needs the recipe id; online) */}
      {!isNew && (
        <section className={sec}>
          <h2 className={h2}>Bilder</h2>
          <div className="flex flex-wrap gap-3">
            {(existing?.images ?? []).map((img) => (
              <div key={img.id} className="relative h-24 w-24 overflow-hidden rounded-lg border border-secondary-200 dark:border-secondary-700">
                <img src={assetUrl(img.url)} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  disabled={imgBusy}
                  aria-label="Bild löschen"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80 disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            ))}
            <label
              className={
                'flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-secondary-300 text-center text-xs text-secondary-500 hover:bg-secondary-100 dark:border-secondary-600 dark:hover:bg-secondary-800 ' +
                (imgBusy ? 'pointer-events-none opacity-50' : '')
              }
            >
              <span className="text-lg">＋</span>
              {imgBusy ? 'Lädt …' : 'Bild'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickImage} data-testid="image-input" />
            </label>
          </div>
          {imgError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{imgError}</p>}
        </section>
      )}

      {/* Ingredients */}
      <section className={sec}>
        <h2 className={h2}>Zutaten</h2>
        <datalist id="ingredient-names">
          {ingredientNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {form.groups.map((g, gi) => (
          <div key={g.id} className="mb-4 rounded-lg border border-secondary-200 p-3 dark:border-secondary-700">
            <div className="mb-2 flex gap-2">
              <input className={field + ' flex-1'} placeholder="Gruppentitel (optional)" value={g.title} onChange={(e) => patch({ groups: form.groups.map((x, j) => (j === gi ? { ...x, title: e.target.value } : x)) })} />
              {form.groups.length > 1 && <button className="px-2 text-red-500" onClick={() => patch({ groups: form.groups.filter((_, j) => j !== gi) })}>Gruppe ✕</button>}
            </div>
            {g.items.map((it, ii) => (
              <div key={it.id} className="mb-1.5 flex gap-2">
                <input className={field + ' w-20'} placeholder="Menge" value={it.amount} onChange={(e) => patch({ groups: form.groups.map((x, j) => (j === gi ? { ...x, items: x.items.map((y, k) => (k === ii ? { ...y, amount: e.target.value } : y)) } : x)) })} />
                <input className={field + ' w-20'} placeholder="Einheit" value={it.unit} onChange={(e) => patch({ groups: form.groups.map((x, j) => (j === gi ? { ...x, items: x.items.map((y, k) => (k === ii ? { ...y, unit: e.target.value } : y)) } : x)) })} />
                <input list="ingredient-names" className={field + ' flex-1'} placeholder="Zutat" value={it.name} onChange={(e) => patch({ groups: form.groups.map((x, j) => (j === gi ? { ...x, items: x.items.map((y, k) => (k === ii ? { ...y, name: e.target.value } : y)) } : x)) })} />
                <button className="px-2 text-red-500" onClick={() => patch({ groups: form.groups.map((x, j) => (j === gi ? { ...x, items: x.items.filter((_, k) => k !== ii) } : x)) })}>✕</button>
              </div>
            ))}
            <button className="text-sm text-primary-600 hover:underline" onClick={() => patch({ groups: form.groups.map((x, j) => (j === gi ? { ...x, items: [...x.items, { id: uid(), name: '', amount: '', unit: '' }] } : x)) })}>+ Zutat</button>
          </div>
        ))}
        <button className="text-sm text-primary-600 hover:underline" onClick={() => patch({ groups: [...form.groups, { id: uid(), title: '', items: [] }] })}>+ Gruppe</button>
      </section>

      {/* Preparation */}
      <section className={sec}>
        <h2 className={h2}>Zubereitung</h2>
        {form.prep.map((g, gi) => (
          <div key={g.id} className="mb-4 rounded-lg border border-secondary-200 p-3 dark:border-secondary-700">
            <div className="mb-2 flex gap-2">
              <input className={field + ' flex-1'} placeholder="Abschnittstitel (optional)" value={g.title} onChange={(e) => patch({ prep: form.prep.map((x, j) => (j === gi ? { ...x, title: e.target.value } : x)) })} />
              {form.prep.length > 1 && <button className="px-2 text-red-500" onClick={() => patch({ prep: form.prep.filter((_, j) => j !== gi) })}>Abschnitt ✕</button>}
            </div>
            {g.steps.map((s, si) => (
              <div key={s.id} className="mb-1.5 flex gap-2">
                <span className="pt-2 text-sm text-secondary-400">{si + 1}.</span>
                <textarea className={field + ' flex-1'} rows={2} placeholder="Schritt" value={s.text} onChange={(e) => patch({ prep: form.prep.map((x, j) => (j === gi ? { ...x, steps: x.steps.map((y, k) => (k === si ? { ...y, text: e.target.value } : y)) } : x)) })} />
                <button className="px-2 text-red-500" onClick={() => patch({ prep: form.prep.map((x, j) => (j === gi ? { ...x, steps: x.steps.filter((_, k) => k !== si) } : x)) })}>✕</button>
              </div>
            ))}
            <button className="text-sm text-primary-600 hover:underline" onClick={() => patch({ prep: form.prep.map((x, j) => (j === gi ? { ...x, steps: [...x.steps, { id: uid(), text: '' }] } : x)) })}>+ Schritt</button>
          </div>
        ))}
        <button className="text-sm text-primary-600 hover:underline" onClick={() => patch({ prep: [...form.prep, { id: uid(), title: '', steps: [] }] })}>+ Abschnitt</button>
      </section>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-8 flex items-center justify-between gap-2 border-t border-secondary-200 pt-4 dark:border-secondary-700">
        {!isNew ? (
          <button onClick={remove} disabled={busy} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400">
            Löschen
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button onClick={() => navigate(isNew ? '/' : `/rezept/${id}`)} disabled={busy} className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600">
            Abbrechen
          </button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
