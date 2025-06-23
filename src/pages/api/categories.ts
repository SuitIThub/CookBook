import type { APIRoute } from 'astro';
import { db } from '../../lib/database';

export const GET: APIRoute = async ({ request }) => {
  try {
    const categories = db.getAllCategories();
    
    // Add some default categories if none exist
    const defaultCategories = [
      'Hauptgericht',
      'Vorspeise',
      'Dessert',
      'Getränk',
      'Snack',
      'Salat',
      'Suppe',
      'Beilage',
      'Frühstück',
      'Kuchen & Gebäck'
    ];
    
    // Combine and deduplicate
    const allCategories = [...new Set([...categories, ...defaultCategories])];
    
    return new Response(JSON.stringify(allCategories), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch categories' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}; 