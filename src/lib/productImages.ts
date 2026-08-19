import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const PRODUCT_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads', 'products');
export const PRODUCT_UPLOADS_URL_PREFIX = '/uploads/products/';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_BYTES = 10 * 1024 * 1024;

export async function ensureProductUploadsDir() {
  await fs.mkdir(PRODUCT_UPLOADS_DIR, { recursive: true });
}

export function isLocalProductImageUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(PRODUCT_UPLOADS_URL_PREFIX) && !url.includes('..');
}

function localPathFromProductImageUrl(url: string): string | null {
  if (!isLocalProductImageUrl(url)) return null;
  const filename = path.basename(url.split('?')[0]);
  if (!/^[0-9a-f-]{36}\.(jpe?g|png|webp)$/i.test(filename)) return null;
  const resolved = path.resolve(path.join(PRODUCT_UPLOADS_DIR, filename));
  const root = path.resolve(PRODUCT_UPLOADS_DIR);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

export async function deleteLocalProductImage(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const filePath = localPathFromProductImageUrl(url);
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}

export async function saveProductImageFile(file: File): Promise<{ url: string; filename: string }> {
  const mime = file.type;
  if (!ALLOWED_TYPES[mime]) {
    throw new Error('Invalid file type. Only JPEG, PNG and WebP are allowed.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('File too large. Maximum size is 10 MB.');
  }

  const fromName = path.extname(file.name).toLowerCase();
  const extension = ALLOWED_TYPES[mime] || (fromName === '.jpeg' ? '.jpg' : fromName);
  const imageId = uuidv4();
  const filename = `${imageId}${extension}`;

  await ensureProductUploadsDir();
  const filePath = path.join(PRODUCT_UPLOADS_DIR, filename);
  const arrayBuffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));

  return {
    filename,
    url: `${PRODUCT_UPLOADS_URL_PREFIX}${filename}`,
  };
}
