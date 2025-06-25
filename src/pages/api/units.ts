import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  try {
    // Standard units used in the application
    const units = [
      // Weight units
      { name: 'g', category: 'weight', displayName: 'Gramm' },
      { name: 'kg', category: 'weight', displayName: 'Kilogramm' },
      
      // Volume units
      { name: 'ml', category: 'volume', displayName: 'Milliliter' },
      { name: 'l', category: 'volume', displayName: 'Liter' },
      { name: 'TL', category: 'volume', displayName: 'Teelöffel' },
      { name: 'EL', category: 'volume', displayName: 'Esslöffel' },
      { name: 'Tasse', category: 'volume', displayName: 'Tasse' },
      { name: 'Becher', category: 'volume', displayName: 'Becher' },
      { name: 'Glas', category: 'volume', displayName: 'Glas' },
      
      // Piece units
      { name: 'Stück', category: 'piece', displayName: 'Stück' },
      { name: 'Pck.', category: 'piece', displayName: 'Packung' },
      { name: 'Dose', category: 'piece', displayName: 'Dose' },
      { name: 'Flasche', category: 'piece', displayName: 'Flasche' },
      { name: 'Tube', category: 'piece', displayName: 'Tube' },
      { name: 'Würfel', category: 'piece', displayName: 'Würfel' },
      { name: 'Riegel', category: 'piece', displayName: 'Riegel' },
      
      // Natural units
      { name: 'Zehe', category: 'natural', displayName: 'Zehe' },
      { name: 'Bund', category: 'natural', displayName: 'Bund' },
      { name: 'Kopf', category: 'natural', displayName: 'Kopf' },
      { name: 'Knolle', category: 'natural', displayName: 'Knolle' },
      { name: 'Stange', category: 'natural', displayName: 'Stange' },
      { name: 'Zweig', category: 'natural', displayName: 'Zweig' },
      { name: 'Blatt', category: 'natural', displayName: 'Blatt' },
      { name: 'Scheibe', category: 'natural', displayName: 'Scheibe' },
      
      // Small measurement units
      { name: 'Prise', category: 'small', displayName: 'Prise' },
      { name: 'Msp.', category: 'small', displayName: 'Messerspitze' },
      { name: 'Tropfen', category: 'small', displayName: 'Tropfen' },
      { name: 'Spritzer', category: 'small', displayName: 'Spritzer' },
      { name: 'Schuss', category: 'small', displayName: 'Schuss' },
      { name: 'Hauch', category: 'small', displayName: 'Hauch' }
    ];

    // Sort by category and then by name
    const sortedUnits = units.sort((a, b) => {
      if (a.category !== b.category) {
        // Define category order
        const categoryOrder = ['weight', 'volume', 'piece', 'natural', 'small'];
        return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
      }
      return a.name.localeCompare(b.name);
    });

    return new Response(JSON.stringify(sortedUnits), {
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