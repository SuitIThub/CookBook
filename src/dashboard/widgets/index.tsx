/** Widget type → component. */
import type { WidgetConfigs, WidgetInstance } from '../model';
import { NoteWidget, PriceChangesWidget, ShoppingListsWidget, ShoppingListWidget, ShortcutsWidget, TimersWidget } from './misc';
import { CookQueueWidget } from './cookQueue';
import { FavoritesWidget, PlannedWidget, RandomRecipeWidget, RecentRecipesWidget, RecommendationsWidget } from './recipes';
import {
  TrackerDayWidget,
  TrackerGoalWidget,
  TrackerLogWidget,
  TrackerMealPrepWidget,
  TrackerSuggestionsWidget,
  TrackerWeekWidget,
  TrackerWeightWidget
} from './tracker';

export function WidgetBody({ widget, onConfigChange }: { widget: WidgetInstance; onConfigChange: (config: WidgetInstance['config']) => void }) {
  const c = widget.config as any;
  switch (widget.type) {
    case 'tracker-day':
      return <TrackerDayWidget />;
    case 'tracker-log':
      return <TrackerLogWidget />;
    case 'tracker-week':
      return <TrackerWeekWidget config={c} />;
    case 'tracker-weight':
      return <TrackerWeightWidget config={c} />;
    case 'tracker-mealprep':
      return <TrackerMealPrepWidget />;
    case 'tracker-goal':
      return <TrackerGoalWidget />;
    case 'tracker-suggestions':
      return <TrackerSuggestionsWidget config={c} />;
    case 'favorites':
      return <FavoritesWidget config={c} />;
    case 'recommendations':
      return <RecommendationsWidget config={c} />;
    case 'planned':
      return <PlannedWidget config={c} />;
    case 'cook-queue':
      return <CookQueueWidget />;
    case 'shopping-lists':
      return <ShoppingListsWidget config={c} />;
    case 'shopping-list':
      return <ShoppingListWidget config={c} />;
    case 'shortcuts':
      return <ShortcutsWidget config={c} />;
    case 'random-recipe':
      return <RandomRecipeWidget config={c} />;
    case 'recent-recipes':
      return <RecentRecipesWidget config={c} />;
    case 'timers':
      return <TimersWidget />;
    case 'price-changes':
      return <PriceChangesWidget config={c} />;
    case 'note':
      return <NoteWidget config={c as WidgetConfigs['note']} onChange={onConfigChange} />;
  }
}

/** Page a widget's title links to (normal mode). */
export function widgetLink(widget: WidgetInstance): string | null {
  if (widget.type.startsWith('tracker-')) return '/tracker';
  if (widget.type === 'shopping-lists') return '/einkaufslisten';
  if (widget.type === 'shopping-list') return (widget.config as WidgetConfigs['shopping-list']).listId ? `/einkaufsliste/${(widget.config as WidgetConfigs['shopping-list']).listId}` : null;
  if (widget.type === 'favorites' || widget.type === 'recent-recipes') return '/rezepte';
  if (widget.type === 'price-changes') return '/produkte';
  return null;
}
