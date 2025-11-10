/**
 * Centralized unit system for recipes and shopping lists
 * 
 * This module defines:
 * - Base units (smallest units stored in database)
 * - Unit conversions (for display purposes)
 * - Unit aliases (for parsing variations)
 * - Unit categories
 */

export interface UnitDefinition {
  name: string; // Canonical unit name (base unit)
  category: 'weight' | 'volume' | 'piece' | 'natural' | 'small';
  displayName: string; // German display name
  isBaseUnit: boolean; // Whether this is a base unit (stored in DB)
  baseUnit?: string; // If not base unit, the base unit it converts to
  conversionFactor?: number; // Factor to convert to base unit (e.g., kg -> g: 1000)
  aliases?: string[]; // Alternative names/variations for parsing
}

/**
 * Base units configuration
 * These are the smallest units that will be stored in the database
 */
export const BASE_UNITS: Record<string, UnitDefinition> = {
  // Weight - base unit: g
  'g': {
    name: 'g',
    category: 'weight',
    displayName: 'Gramm',
    isBaseUnit: true,
    aliases: ['g', 'G', 'Gramm', 'gramm', 'gram']
  },
  
  // Volume - base unit: ml
  'ml': {
    name: 'ml',
    category: 'volume',
    displayName: 'Milliliter',
    isBaseUnit: true,
    aliases: ['ml', 'ML', 'Milliliter', 'milliliter']
  },
  
  // Piece - base unit: Stück
  'Stück': {
    name: 'Stück',
    category: 'piece',
    displayName: 'Stück',
    isBaseUnit: true,
    aliases: ['Stück', 'Stk.', 'Stk', 'stück', 'stk.', 'stk', 'St.', 'St']
  },
  
  // Natural units - these don't convert, each is its own base
  'Zehe': {
    name: 'Zehe',
    category: 'natural',
    displayName: 'Zehe',
    isBaseUnit: true,
    aliases: ['Zehe', 'Zehen', 'zehe', 'zehen']
  },
  'Bund': {
    name: 'Bund',
    category: 'natural',
    displayName: 'Bund',
    isBaseUnit: true,
    aliases: ['Bund', 'bund']
  },
  'Kopf': {
    name: 'Kopf',
    category: 'natural',
    displayName: 'Kopf',
    isBaseUnit: true,
    aliases: ['Kopf', 'Köpfe', 'kopf', 'köpfe']
  },
  'Knolle': {
    name: 'Knolle',
    category: 'natural',
    displayName: 'Knolle',
    isBaseUnit: true,
    aliases: ['Knolle', 'Knollen', 'knolle', 'knollen']
  },
  'Stange': {
    name: 'Stange',
    category: 'natural',
    displayName: 'Stange',
    isBaseUnit: true,
    aliases: ['Stange', 'Stangen', 'stange', 'stangen']
  },
  'Zweig': {
    name: 'Zweig',
    category: 'natural',
    displayName: 'Zweig',
    isBaseUnit: true,
    aliases: ['Zweig', 'Zweige', 'zweig', 'zweige']
  },
  'Blatt': {
    name: 'Blatt',
    category: 'natural',
    displayName: 'Blatt',
    isBaseUnit: true,
    aliases: ['Blatt', 'Blätter', 'blatt', 'blätter']
  },
  'Scheibe': {
    name: 'Scheibe',
    category: 'natural',
    displayName: 'Scheibe',
    isBaseUnit: true,
    aliases: ['Scheibe', 'Scheiben', 'scheibe', 'scheiben']
  },
  
  // Small measurement units - these don't convert
  'Prise': {
    name: 'Prise',
    category: 'small',
    displayName: 'Prise',
    isBaseUnit: true,
    aliases: ['Prise', 'Pr.', 'PR.', 'prise', 'pr.']
  },
  'Msp.': {
    name: 'Msp.',
    category: 'small',
    displayName: 'Messerspitze',
    isBaseUnit: true,
    aliases: ['Msp.', 'MSP.', 'Messerspitze', 'messerspitze']
  },
  'Tropfen': {
    name: 'Tropfen',
    category: 'small',
    displayName: 'Tropfen',
    isBaseUnit: true,
    aliases: ['Tropfen', 'Tr.', 'TR.', 'tropfen', 'tr.']
  },
  'Spritzer': {
    name: 'Spritzer',
    category: 'small',
    displayName: 'Spritzer',
    isBaseUnit: true,
    aliases: ['Spritzer', 'spritzer']
  },
  'Schuss': {
    name: 'Schuss',
    category: 'small',
    displayName: 'Schuss',
    isBaseUnit: true,
    aliases: ['Schuss', 'schuss']
  },
  'Hauch': {
    name: 'Hauch',
    category: 'small',
    displayName: 'Hauch',
    isBaseUnit: true,
    aliases: ['Hauch', 'hauch']
  },
  
  // Volume units - base units that don't convert
  'TL': {
    name: 'TL',
    category: 'volume',
    displayName: 'Teelöffel',
    isBaseUnit: true,
    aliases: ['TL', 'Teelöffel', 'teelöffel', 'tl']
  },
  'EL': {
    name: 'EL',
    category: 'volume',
    displayName: 'Esslöffel',
    isBaseUnit: true,
    aliases: ['EL', 'Esslöffel', 'Eßlöffel', 'esslöffel', 'eßlöffel', 'el']
  },
  'Tasse': {
    name: 'Tasse',
    category: 'volume',
    displayName: 'Tasse',
    isBaseUnit: false,
    baseUnit: 'ml',
    conversionFactor: 250, // 1 Tasse = 250 ml
    aliases: ['Tasse', 'Tassen', 'tasse', 'tassen']
  },
  'Becher': {
    name: 'Becher',
    category: 'volume',
    displayName: 'Becher',
    isBaseUnit: false,
    baseUnit: 'ml',
    conversionFactor: 200, // 1 Becher = 200 ml (approximate)
    aliases: ['Becher', 'becher']
  },
  'Glas': {
    name: 'Glas',
    category: 'volume',
    displayName: 'Glas',
    isBaseUnit: false,
    baseUnit: 'ml',
    conversionFactor: 200, // 1 Glas = 200 ml (approximate)
    aliases: ['Glas', 'Gläser', 'glas', 'gläser']
  },
  'l': {
    name: 'l',
    category: 'volume',
    displayName: 'Liter',
    isBaseUnit: false,
    baseUnit: 'ml',
    conversionFactor: 1000, // 1 l = 1000 ml
    aliases: ['l', 'L', 'Liter', 'liter']
  },
  
  // Weight units that convert to g
  'kg': {
    name: 'kg',
    category: 'weight',
    displayName: 'Kilogramm',
    isBaseUnit: false,
    baseUnit: 'g',
    conversionFactor: 1000, // 1 kg = 1000 g
    aliases: ['kg', 'KG', 'Kilogramm', 'kilogramm', 'kilogram']
  },
  
  // Piece units that convert to Stück
  'Pck.': {
    name: 'Pck.',
    category: 'piece',
    displayName: 'Packung',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1, // 1 Pck. = 1 Stück
    aliases: ['Pck.', 'Pck', 'Packung', 'Pack', 'pck.', 'pck', 'packung', 'pack']
  },
  'Päckchen': {
    name: 'Päckchen',
    category: 'piece',
    displayName: 'Päckchen',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1,
    aliases: ['Päckchen', 'päckchen']
  },
  'Dose': {
    name: 'Dose',
    category: 'piece',
    displayName: 'Dose',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1,
    aliases: ['Dose', 'Dosen', 'dose', 'dosen']
  },
  'Flasche': {
    name: 'Flasche',
    category: 'piece',
    displayName: 'Flasche',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1,
    aliases: ['Flasche', 'Flaschen', 'flasche', 'flaschen']
  },
  'Tube': {
    name: 'Tube',
    category: 'piece',
    displayName: 'Tube',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1,
    aliases: ['Tube', 'Tuben', 'tube', 'tuben']
  },
  'Würfel': {
    name: 'Würfel',
    category: 'piece',
    displayName: 'Würfel',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1,
    aliases: ['Würfel', 'würfel']
  },
  'Riegel': {
    name: 'Riegel',
    category: 'piece',
    displayName: 'Riegel',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1,
    aliases: ['Riegel', 'riegel']
  },
  'Rolle': {
    name: 'Rolle',
    category: 'piece',
    displayName: 'Rolle',
    isBaseUnit: false,
    baseUnit: 'Stück',
    conversionFactor: 1,
    aliases: ['Rolle', 'Rollen', 'rolle', 'rollen']
  },
  'Handvoll': {
    name: 'Handvoll',
    category: 'natural',
    displayName: 'Handvoll',
    isBaseUnit: true,
    aliases: ['Handvoll', 'handvoll']
  }
};

/**
 * Get all base units (units that are stored in the database)
 */
export function getBaseUnits(): UnitDefinition[] {
  return Object.values(BASE_UNITS).filter(unit => unit.isBaseUnit);
}

/**
 * Get all available units (for dropdowns, etc.)
 * Returns base units only, as those are what should be used for input
 */
export function getAvailableUnits(): Array<{ name: string; category: string; displayName: string }> {
  return getBaseUnits().map(unit => ({
    name: unit.name,
    category: unit.category,
    displayName: unit.displayName
  }));
}

/**
 * Find a unit by its name or alias
 */
export function findUnit(unitName: string): UnitDefinition | undefined {
  if (!unitName) return undefined;
  
  const normalized = unitName.trim();
  
  // First try exact match
  if (BASE_UNITS[normalized]) {
    return BASE_UNITS[normalized];
  }
  
  // Then try case-insensitive match
  const lower = normalized.toLowerCase();
  for (const unit of Object.values(BASE_UNITS)) {
    if (unit.name.toLowerCase() === lower) {
      return unit;
    }
    if (unit.aliases?.some(alias => alias.toLowerCase() === lower)) {
      return unit;
    }
  }
  
  return undefined;
}

/**
 * Normalize a unit to its base unit
 * Returns the base unit name and the conversion factor
 */
export function normalizeToBaseUnit(unitName: string): { baseUnit: string; conversionFactor: number } | null {
  const unit = findUnit(unitName);
  if (!unit) return null;
  
  if (unit.isBaseUnit) {
    return { baseUnit: unit.name, conversionFactor: 1 };
  }
  
  if (unit.baseUnit && unit.conversionFactor) {
    return { baseUnit: unit.baseUnit, conversionFactor: unit.conversionFactor };
  }
  
  return null;
}

/**
 * Convert an amount from a given unit to its base unit
 */
export function convertToBaseUnit(amount: number, unitName: string): { amount: number; baseUnit: string } | null {
  const normalized = normalizeToBaseUnit(unitName);
  if (!normalized) return null;
  
  return {
    amount: amount * normalized.conversionFactor,
    baseUnit: normalized.baseUnit
  };
}

/**
 * Convert an amount from base unit to a display unit
 * Returns the best display unit and converted amount
 */
export function convertFromBaseUnit(amount: number, baseUnit: string): { amount: number; unit: string; displayName: string } {
  // Find all units that convert to this base unit
  const displayUnits = Object.values(BASE_UNITS).filter(
    unit => !unit.isBaseUnit && unit.baseUnit === baseUnit && unit.conversionFactor
  );
  
  // Sort by conversion factor (largest first)
  displayUnits.sort((a, b) => (b.conversionFactor || 0) - (a.conversionFactor || 0));
  
  // Find the largest unit that fits (amount >= 1 of that unit)
  for (const displayUnit of displayUnits) {
    // Skip conversion if factor is 1 - no benefit in converting to equivalent unit
    if (displayUnit.conversionFactor === 1) {
      continue;
    }
    
    const convertedAmount = amount / (displayUnit.conversionFactor || 1);
    // Use this unit if the converted amount is >= 1 and is a "nice" number
    if (convertedAmount >= 1 && convertedAmount < 1000) {
      // Round to 1 decimal place if needed
      const rounded = Math.round(convertedAmount * 10) / 10;
      return {
        amount: rounded,
        unit: displayUnit.name,
        displayName: displayUnit.displayName
      };
    }
  }
  
  // No suitable display unit found, use base unit
  const baseUnitDef = BASE_UNITS[baseUnit];
  return {
    amount: Math.round(amount * 10) / 10, // Round to 1 decimal
    unit: baseUnit,
    displayName: baseUnitDef?.displayName || baseUnit
  };
}

/**
 * Format a quantity for display
 * Converts to appropriate display unit if needed
 */
export function formatQuantity(amount: number, unit: string): { amount: number; unit: string; displayName: string } {
  // First normalize to base unit
  const normalized = normalizeToBaseUnit(unit);
  if (!normalized) {
    // Unit not found, return as-is
    return { amount, unit, displayName: unit };
  }
  
  // If already a base unit, try to convert to display unit
  if (normalized.baseUnit === unit) {
    return convertFromBaseUnit(amount, unit);
  }
  
  // If conversion factor is 1, preserve the original unit (no actual conversion)
  if (normalized.conversionFactor === 1) {
    const unitDef = findUnit(unit);
    return {
      amount,
      unit,
      displayName: unitDef?.displayName || unit
    };
  }
  
  // Convert to base unit first, then to display unit
  const baseAmount = amount * normalized.conversionFactor;
  return convertFromBaseUnit(baseAmount, normalized.baseUnit);
}

/**
 * Get unit variations for parsing (used in recipe extractors)
 */
export function getUnitVariations(): Array<{ unit: string; variations: string[] }> {
  return Object.values(BASE_UNITS).map(unit => ({
    unit: unit.isBaseUnit ? unit.name : (unit.baseUnit || unit.name),
    variations: [unit.name, ...(unit.aliases || [])]
  }));
}

