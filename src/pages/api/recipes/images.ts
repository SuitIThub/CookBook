import type { APIRoute } from 'astro';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import type { RecipeImage } from '../../../types/recipe';
import CookbookDatabase from '../../../lib/database';

const db = new CookbookDatabase();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads', 'recipes');

async function ensureUploadsDir() {
  try {
    await fs.access(UPLOADS_DIR);
  } catch {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const recipeId = formData.get('recipeId') as string;

    if (!file || !recipeId) {
      return new Response(JSON.stringify({ error: 'File and recipe ID are required' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Check if recipe exists
    const recipe = db.getRecipe(recipeId);
    if (!recipe) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return new Response(JSON.stringify({ error: 'Invalid file type. Only JPEG, PNG and WebP are allowed.' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Generate unique filename
    const imageId = uuidv4();
    const fileExtension = path.extname(file.name);
    const filename = `${imageId}${fileExtension}`;
    
    await ensureUploadsDir();
    const filePath = path.join(UPLOADS_DIR, filename);

    // Save file
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));

    // Create image record
    const newImage: RecipeImage = {
      id: imageId,
      filename,
      url: `/uploads/recipes/${filename}`,
      uploadedAt: new Date()
    };

    // Update recipe with new image
    const updatedImages = [...(recipe.images || []), newImage];
    const updatedRecipe = db.updateRecipe(recipeId, { images: updatedImages });

    if (!updatedRecipe) {
      // Clean up file if database update failed
      await fs.unlink(filePath).catch(() => {});
      return new Response(JSON.stringify({ error: 'Failed to update recipe' }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    return new Response(JSON.stringify(newImage), { 
      status: 201, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('Error uploading image:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
};

export const DELETE: APIRoute = async ({ request, url }) => {
  try {
    const recipeId = url.searchParams.get('recipeId');
    const imageId = url.searchParams.get('imageId');

    if (!recipeId || !imageId) {
      return new Response(JSON.stringify({ error: 'Recipe ID and image ID are required' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Get recipe
    const recipe = db.getRecipe(recipeId);
    if (!recipe) {
      return new Response(JSON.stringify({ error: 'Recipe not found' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Find image to delete
    const imageToDelete = recipe.images?.find((img: RecipeImage) => img.id === imageId);
    if (!imageToDelete) {
      return new Response(JSON.stringify({ error: 'Image not found' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Remove image from database
    const updatedImages = recipe.images?.filter((img: RecipeImage) => img.id !== imageId) || [];
    console.log('Original images count:', recipe.images?.length || 0);
    console.log('Updated images count:', updatedImages.length);
    console.log('Image ID to delete:', imageId);
    
    const updatedRecipe = db.updateRecipe(recipeId, { images: updatedImages });

    if (!updatedRecipe) {
      console.error('Failed to update recipe in database');
      return new Response(JSON.stringify({ error: 'Failed to update recipe' }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    console.log('Successfully updated recipe with new images array');

    // Verify the update by re-fetching the recipe
    const verificationRecipe = db.getRecipe(recipeId);
    const remainingImageIds = verificationRecipe?.images?.map(img => img.id) || [];
    
    if (remainingImageIds.includes(imageId)) {
      console.error('Database update verification failed - image ID still present');
      return new Response(JSON.stringify({ error: 'Failed to remove image from database' }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Delete file from filesystem
    const filePath = path.join(UPLOADS_DIR, imageToDelete.filename);
    await fs.unlink(filePath).catch(() => {
      // File might not exist, continue anyway
      console.log('File already deleted or not found:', filePath);
    });

    console.log('Image deletion completed successfully');
    return new Response(JSON.stringify({ success: true }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('Error deleting image:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}; 