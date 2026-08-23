/**
 * Product image upload. Images are binary files stored on the server (under
 * /uploads) and referenced from the product by URL, so upload is online-only and
 * token-gated. Mirrors the website's POST /api/products/images. Users can always
 * paste a URL instead (works offline).
 */
import { apiUpload } from './api';

export async function uploadProductImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('image', file);
  return apiUpload<{ url: string }>('/api/products/images', form);
}
