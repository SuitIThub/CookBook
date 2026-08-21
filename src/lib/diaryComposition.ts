import type { NutritionData } from '../types/recipe';
import type { DiaryComponent, DiaryComposition, Product } from '../types/tracker';
import type { IngredientResolution } from './recipeNutrition';
import { addNutrition, scaleNutrition } from './calorieGoal';
import { roundNutritionValues } from './recipeNutrition';

export function nutritionForGrams(per100: NutritionData | undefined, grams: number): NutritionData {
  if (!per100 || !Number.isFinite(grams) || grams <= 0) return {};
  return roundNutritionValues(scaleNutrition(per100, grams / 100));
}

/** Frozen cost of a product amount: grams / netGrams × (default or first market price). */
export function productCostForGrams(
  product: Pick<Product, 'defaultPrice' | 'netGrams' | 'supermarkets'> | null | undefined,
  grams: number
): number | undefined {
  if (!product || !Number.isFinite(grams) || grams <= 0) return undefined;
  const rawPrice = Number.isFinite(Number(product.defaultPrice))
    ? Number(product.defaultPrice)
    : (Array.isArray(product.supermarkets) && product.supermarkets.length > 0
      ? Number(product.supermarkets[0]?.price)
      : NaN);
  const net = Number(product.netGrams);
  if (!Number.isFinite(rawPrice) || rawPrice < 0 || !Number.isFinite(net) || net <= 0) return undefined;
  return Math.round((grams / net) * rawPrice * 100) / 100;
}

export function emptyComposition(): DiaryComposition {
  return { components: [] };
}

export function sumComposition(composition: DiaryComposition | undefined): {
  nutrition: NutritionData;
  cost?: number;
} {
  const components = composition?.components ?? [];
  let nutrition: NutritionData = {};
  let cost = 0;
  let hasCost = false;
  for (const component of components) {
    nutrition = addNutrition(nutrition, component.nutrition || {});
    if (Number.isFinite(Number(component.costSnapshot)) && Number(component.costSnapshot) >= 0) {
      cost += Number(component.costSnapshot);
      hasCost = true;
    }
  }
  return {
    nutrition: roundNutritionValues(nutrition),
    cost: hasCost ? Math.round(cost * 100) / 100 : undefined,
  };
}

export function replaceComponent(
  composition: DiaryComposition,
  componentId: string,
  next: DiaryComponent
): DiaryComposition {
  return {
    components: composition.components.map((c) => (c.id === componentId ? next : c)),
  };
}

export function addComponent(composition: DiaryComposition, extra: DiaryComponent): DiaryComposition {
  return { components: [...composition.components, extra] };
}

export function removeComponent(composition: DiaryComposition, componentId: string): DiaryComposition {
  return { components: composition.components.filter((c) => c.id !== componentId) };
}

export function findComponent(composition: DiaryComposition, componentId: string): DiaryComponent | undefined {
  return composition.components.find((c) => c.id === componentId);
}

/**
 * Turn whole-recipe ingredient resolutions into a diary snapshot for the
 * eaten portion (`factor` = eatenServings / recipeServings).
 */
export function componentsFromResolutions(
  resolutions: IngredientResolution[],
  priceByIngredientId: Map<string, IngredientResolution>,
  factor: number,
  newId: () => string
): DiaryComponent[] {
  const scale = Number.isFinite(factor) && factor > 0 ? factor : 0;
  const out: DiaryComponent[] = [];
  for (const res of resolutions) {
    const grams = res.grams != null && Number.isFinite(res.grams) ? Math.round(res.grams * scale * 100) / 100 : 0;
    const priced = priceByIngredientId.get(res.ingredientId);
    const price = priced?.price != null && Number.isFinite(priced.price)
      ? Math.round(priced.price * scale * 100) / 100
      : undefined;
    out.push({
      id: newId(),
      kind: 'ingredient',
      recipeIngredientId: res.ingredientId,
      catalogueIngredientId: res.matchedCatalogueId,
      name: res.name,
      productId: res.matchedProductId,
      grams,
      nutrition: res.contribution ? roundNutritionValues(scaleNutrition(res.contribution, scale)) : {},
      costSnapshot: price,
      isEstimated: res.state === 'estimated',
    });
  }
  return out;
}

export function applyNutritionSource(
  component: DiaryComponent,
  source: {
    nutritionPer100g?: NutritionData;
    product?: Pick<Product, 'id' | 'name' | 'brand' | 'imageUrl' | 'defaultPrice' | 'netGrams' | 'supermarkets' | 'nutritionPer100g'> | null;
    catalogueIngredientId?: string;
  }
): DiaryComponent {
  const product = source.product;
  const per100 = product?.nutritionPer100g ?? source.nutritionPer100g;
  const grams = Number.isFinite(component.grams) ? component.grams : 0;
  const next: DiaryComponent = {
    ...component,
    nutrition: nutritionForGrams(per100, grams),
    costSnapshot: product ? productCostForGrams(product, grams) : undefined,
    isEstimated: component.isEstimated,
  };
  if (source.catalogueIngredientId !== undefined) {
    next.catalogueIngredientId = source.catalogueIngredientId || undefined;
  }
  if (product) {
    next.productId = product.id;
    next.productName = product.name;
    next.productBrand = product.brand;
    next.productImageUrl = product.imageUrl;
  } else {
    next.productId = undefined;
    next.productName = undefined;
    next.productBrand = undefined;
    next.productImageUrl = undefined;
  }
  return next;
}

export function extraFromSource(
  source: {
    nutritionPer100g?: NutritionData;
    product?: Pick<Product, 'id' | 'name' | 'brand' | 'imageUrl' | 'defaultPrice' | 'netGrams' | 'supermarkets' | 'nutritionPer100g'> | null;
    catalogueIngredientId?: string;
    name?: string;
  },
  grams: number,
  newId: () => string
): DiaryComponent {
  const product = source.product;
  const per100 = product?.nutritionPer100g ?? source.nutritionPer100g;
  return {
    id: newId(),
    kind: 'extra',
    catalogueIngredientId: source.catalogueIngredientId,
    name: source.name || product?.name || 'Produkt',
    productId: product?.id,
    productName: product?.name,
    productBrand: product?.brand,
    productImageUrl: product?.imageUrl,
    grams: Math.round(grams * 100) / 100,
    nutrition: nutritionForGrams(per100, grams),
    costSnapshot: product ? productCostForGrams(product, grams) : undefined,
  };
}
