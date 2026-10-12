/** Settings dialog of a widget (edit mode → gear). Edits a copy; "Übernehmen" saves it. */
import { useState, type ReactNode } from 'react';
import type { RecommendationCriteria } from '../lib/weekRecommendations';
import { useDashboardData } from './data';
import { SHORTCUTS, WIDGETS, type ShortcutId, type WidgetConfigs, type WidgetInstance, type WidgetType } from './model';
import { Async, btnPrimary, btnSecondary, inputClass, Modal, useLoad } from './ui';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="font-medium text-gray-800 dark:text-gray-200">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-2 flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-gray-800 dark:text-gray-200">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

function NumberSelect({ value, options, onChange, suffix = '' }: { value: number; options: number[]; onChange: (v: number) => void; suffix?: string }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
          {suffix}
        </option>
      ))}
    </select>
  );
}

const CRITERIA_LABELS: Record<keyof RecommendationCriteria, { label: string; hint: string }> = {
  favorites: { label: 'Favoriten bevorzugen', hint: 'Mit Stern markierte Rezepte kommen öfter vor.' },
  longNotEaten: { label: 'Lange nicht gegessen', hint: 'Bevorzugt Rezepte, die lange nicht im Tagebuch/Plan waren; die letzte Woche wird ausgelassen.' },
  calorieGoal: { label: 'Passend zum Kalorienziel', hint: 'Portionen nahe an deinem Ziel pro Hauptmahlzeit.' },
  variety: { label: 'Abwechslung', hint: 'Verschiedene Kategorien und Hauptzutaten über die Woche.' }
};

function Editor<T extends WidgetType>({ type, config, set }: { type: T; config: WidgetConfigs[T]; set: (c: WidgetConfigs[T]) => void }) {
  // Narrowing helper: the switch below knows the concrete config type.
  const c = config as any;
  const upd = (patch: Record<string, unknown>) => set({ ...c, ...patch });

  switch (type) {
    case 'tracker-week':
      return (
        <Field label="Zeitraum">
          <NumberSelect value={c.days} options={[7, 14]} suffix=" Tage" onChange={(days) => upd({ days })} />
        </Field>
      );
    case 'tracker-weight':
      return (
        <Field label="Verlauf">
          <NumberSelect value={c.days} options={[30, 90, 365]} suffix=" Tage" onChange={(days) => upd({ days })} />
        </Field>
      );
    case 'tracker-suggestions':
    case 'favorites':
    case 'recent-recipes':
    case 'price-changes':
      return (
        <Field label="Anzahl">
          <NumberSelect value={c.count} options={type === 'favorites' ? [3, 6, 9, 12] : [3, 4, 5, 6, 8, 10]} onChange={(count) => upd({ count })} />
        </Field>
      );
    case 'recommendations':
      return (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">Worauf sollen die Vorschläge basieren?</p>
          {(Object.keys(CRITERIA_LABELS) as (keyof RecommendationCriteria)[]).map((k) => (
            <Check key={k} label={CRITERIA_LABELS[k].label} hint={CRITERIA_LABELS[k].hint} checked={c.criteria[k]} onChange={(v) => upd({ criteria: { ...c.criteria, [k]: v } })} />
          ))}
          {c.criteria.calorieGoal && (
            <Field label="Anteil einer Hauptmahlzeit am Tagesziel" hint="Bei 2 000 kcal Tagesziel und 40 % passen Portionen um 800 kcal am besten.">
              <NumberSelect value={c.mealShare} options={[25, 30, 35, 40, 45, 50]} suffix=" %" onChange={(mealShare) => upd({ mealShare })} />
            </Field>
          )}
          <Field label="Anzahl Vorschläge">
            <NumberSelect value={c.count} options={[3, 4, 5, 6, 8, 10]} onChange={(count) => upd({ count })} />
          </Field>
          <Check label="Button „KI-Wochenplan“ anzeigen" hint="Die KI stellt aus den Vorschlägen einen ausgewogenen Meal-Prep-Plan zusammen (online)." checked={c.aiPlan} onChange={(aiPlan) => upd({ aiPlan })} />
          {c.aiPlan && (
            <Field label="Gerichte pro KI-Wochenplan">
              <NumberSelect value={c.aiDishes} options={[2, 3, 4, 5, 6, 7]} onChange={(aiDishes) => upd({ aiDishes })} />
            </Field>
          )}
        </div>
      );
    case 'planned':
      return (
        <div>
          <Field label="Vorausschau">
            <NumberSelect value={c.days} options={[7, 14]} suffix=" Tage" onChange={(days) => upd({ days })} />
          </Field>
          <Check label="Schon gekochte, noch offene Portionen zeigen" checked={c.showOpen} onChange={(showOpen) => upd({ showOpen })} />
        </div>
      );
    case 'shopping-lists':
      return (
        <div>
          <Field label="Höchstens anzeigen">
            <NumberSelect value={c.count} options={[3, 5, 8, 12]} suffix=" Listen" onChange={(count) => upd({ count })} />
          </Field>
          <Check label="Sammelliste anzeigen" checked={c.showPermanent} onChange={(showPermanent) => upd({ showPermanent })} />
          <Check label="Erledigte und leere Listen ausblenden" checked={c.hideEmpty} onChange={(hideEmpty) => upd({ hideEmpty })} />
        </div>
      );
    case 'shopping-list':
      return <ListPicker value={c.listId} hideChecked={c.hideChecked} onChange={upd} />;
    case 'shortcuts': {
      const groups = new Map<string, ShortcutId[]>();
      for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) groups.set(SHORTCUTS[id].group, [...(groups.get(SHORTCUTS[id].group) ?? []), id]);
      return (
        <div>
          <p className="mb-2 text-xs text-gray-500">Reihenfolge = Reihenfolge des Anklickens.</p>
          {[...groups].map(([group, ids]) => (
            <div key={group} className="mb-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{group}</p>
              {ids.map((id) => (
                <Check
                  key={id}
                  label={SHORTCUTS[id].label}
                  checked={c.items.includes(id)}
                  onChange={(v) => upd({ items: v ? [...c.items, id] : c.items.filter((x: ShortcutId) => x !== id) })}
                />
              ))}
            </div>
          ))}
        </div>
      );
    }
    case 'random-recipe':
      return <CategoryPicker value={c.category} onChange={(category) => upd({ category })} />;
    case 'note':
      return (
        <Field label="Titel">
          <input className={inputClass} value={c.title} onChange={(e) => upd({ title: e.target.value })} />
        </Field>
      );
    default:
      return <p className="text-sm text-gray-500">Dieses Widget hat keine Einstellungen.</p>;
  }
}

function ListPicker({ value, hideChecked, onChange }: { value: string; hideChecked: boolean; onChange: (p: Record<string, unknown>) => void }) {
  const host = useDashboardData();
  const state = useLoad(() => host.shoppingLists(), []);
  return (
    <Async state={state}>
      {(lists) => (
        <div>
          <Field label="Liste">
            <select className={inputClass} value={value} onChange={(e) => onChange({ listId: e.target.value })}>
              <option value="">– bitte wählen –</option>
              {lists
                .filter((l) => l.permanentType !== 2)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                    {l.permanentType === 1 ? ' (Sammelliste)' : ''}
                  </option>
                ))}
            </select>
          </Field>
          <Check label="Abgehakte Posten ausblenden" checked={hideChecked} onChange={(v) => onChange({ hideChecked: v })} />
        </div>
      )}
    </Async>
  );
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const host = useDashboardData();
  const state = useLoad(() => host.recipes(), []);
  return (
    <Async state={state}>
      {(recipes) => {
        const cats = [...new Set(recipes.map((r) => r.category).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'de'));
        return (
          <Field label="Kategorie">
            <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
              <option value="">Alle Kategorien</option>
              {cats.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </Field>
        );
      }}
    </Async>
  );
}

export function WidgetSettings({ widget, onSave, onClose }: { widget: WidgetInstance; onSave: (config: WidgetInstance['config']) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(widget.config);
  return (
    <Modal
      title={`${WIDGETS[widget.type].title} – Einstellungen`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Übernehmen
          </button>
        </>
      }
    >
      <Editor type={widget.type} config={draft} set={setDraft} />
    </Modal>
  );
}
