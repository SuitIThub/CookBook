import type { APIRoute } from 'astro';
import { getAvailableUnits, BASE_UNITS } from '../../lib/units';

export const GET: APIRoute = async ({ url }) => {
  try {
    // Get base units from centralized configuration
    const units = getAvailableUnits();

    // Sort by category and then by name
    const sortedUnits = units.sort((a, b) => {
      if (a.category !== b.category) {
        // Define category order
        const categoryOrder = ['weight', 'volume', 'piece', 'natural', 'small'];
        return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
      }
      return a.name.localeCompare(b.name);
    });

    // Build conversion data for client-side formatting
    // This maps base units to their display units (larger units for display)
    const conversionData: Record<string, Array<{ name: string; factor: number }>> = {};
    
    // For each base unit, find all units that convert to it (for display purposes)
    Object.values(BASE_UNITS).forEach(unit => {
      if (unit.isBaseUnit) {
        // Find all units that convert to this base unit
        const displayUnits = Object.values(BASE_UNITS)
          .filter(u => !u.isBaseUnit && u.baseUnit === unit.name && u.conversionFactor)
          .map(u => ({
            name: u.name,
            factor: u.conversionFactor!
          }))
          .sort((a, b) => b.factor - a.factor); // Sort by factor (largest first)
        
        if (displayUnits.length > 0) {
          conversionData[unit.name] = displayUnits;
        } else {
          conversionData[unit.name] = [];
        }
      }
    });

    return new Response(JSON.stringify({
      units: sortedUnits,
      conversions: conversionData
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error fetching units:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch units' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}; 