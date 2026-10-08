/**
 * Port of components/recipe/RecipeImageGallery.astro (+ LightboxModal and
 * ImageUploadModal). Uploading a file needs the server (binary under /uploads);
 * adding an image by URL works offline (stored in the recipe like the website).
 * On device the file picker also offers the camera.
 */
import { useEffect, useRef, useState } from 'react';
import type { Recipe, RecipeImage } from '@/types';
import { assetUrl } from '@/lib/api';
import { uploadRecipeImage, deleteRecipeImage } from '@/lib/recipeImages';

export default function RecipeImageGallery({
  recipe,
  mode = 'view',
  hidden = false,
  onChanged,
  onAddByUrl
}: {
  recipe: Recipe;
  mode?: 'view' | 'edit';
  /** Datenspar-Modus: the gallery is not shown at all (like the website). */
  hidden?: boolean;
  onChanged: () => void;
  onAddByUrl: (image: RecipeImage) => Promise<void>;
}) {
  const images = recipe.images ?? [];
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [upload, setUpload] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const notify = (text: string, type: 'success' | 'error') => {
    setNotice({ text, type });
    setTimeout(() => setNotice(null), 3000);
  };
  if (hidden) return null;

  const remove = async (img: RecipeImage) => {
    if (!confirm('Möchten Sie dieses Bild wirklich löschen?')) return;
    try {
      await deleteRecipeImage(recipe.id, img.id);
      notify('Bild erfolgreich gelöscht!', 'success');
      onChanged();
    } catch (e) {
      notify((e as Error).message || 'Fehler beim Löschen des Bildes', 'error');
    }
  };

  return (
    <div>
      {images.length > 0 && (
        <div className="recipe-page-image-gallery mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Bilder</h2>
          <div className="flex space-x-4 overflow-x-auto pb-2">
            {images.map((image, i) => (
              <div key={image.id} className="group relative flex-shrink-0">
                <div className="h-32 w-32 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
                  <img src={assetUrl(image.url)} alt="Recipe image" onClick={() => setLightbox(i)} className="h-full w-full cursor-pointer object-cover transition-transform duration-200 hover:scale-105" />
                </div>
                {mode === 'edit' && (
                  <button type="button" onClick={() => remove(image)} title="Bild löschen" className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white shadow-md transition-colors hover:bg-red-600">
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="flex-shrink-0">
              <button type="button" onClick={() => setUpload(true)} className="block h-32 w-32 cursor-pointer rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-orange-400 dark:border-gray-600 dark:bg-gray-700/50 dark:hover:border-orange-500">
                <div className="flex h-full flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                  <svg className="mb-2 h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  <span className="text-center text-xs">Bild hinzufügen</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
      {mode === 'view' && images.length === 0 && (
        <div className="recipe-page-image-gallery mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Bilder</h2>
            <button type="button" onClick={() => setUpload(true)} className="flex cursor-pointer items-center space-x-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              <span>Erstes Bild hinzufügen</span>
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Fügen Sie Bilder hinzu, um Ihr Rezept visuell zu präsentieren.</p>
        </div>
      )}
      {lightbox !== null && images.length > 0 && <Lightbox images={images} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />}
      {upload && (
        <ImageUploadModal
          onClose={() => setUpload(false)}
          onFile={async (file) => {
            await uploadRecipeImage(recipe.id, file);
            notify('Bild erfolgreich hochgeladen!', 'success');
            setUpload(false);
            onChanged();
          }}
          onUrl={async (url) => {
            await onAddByUrl({ id: `url-${Date.now()}`, filename: `url-image-${Date.now()}.jpg`, url, uploadedAt: new Date() } as RecipeImage);
            notify('Bild erfolgreich hinzugefügt!', 'success');
            setUpload(false);
          }}
        />
      )}
      {notice && <div className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-2 text-white shadow-lg ${notice.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>{notice.text}</div>}
    </div>
  );
}

function Lightbox({ images, index, onIndex, onClose }: { images: RecipeImage[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const prev = () => onIndex((index - 1 + images.length) % images.length);
  const next = () => onIndex((index + 1) % images.length);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  // Swipe on touch devices.
  const touchX = useRef<number | null>(null);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const x0 = touchX.current;
        const x1 = e.changedTouches[0]?.clientX;
        if (x0 != null && x1 != null && Math.abs(x1 - x0) > 50 && images.length > 1) (x1 < x0 ? next : prev)();
        touchX.current = null;
      }}
    >
      <div className="relative max-h-full max-w-4xl p-4">
        <button onClick={onClose} className="absolute right-4 top-4 z-10 text-white hover:text-gray-300" aria-label="Schließen">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <img src={assetUrl(images[index].url)} alt="" className="max-h-full max-w-full object-contain" />
        {images.length > 1 && (
          <>
            <button onClick={prev} className="absolute left-4 top-1/2 -translate-y-1/2 transform rounded-full bg-black bg-opacity-50 p-2 text-white hover:text-gray-300" aria-label="Vorheriges Bild">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button onClick={next} className="absolute right-4 top-1/2 -translate-y-1/2 transform rounded-full bg-black bg-opacity-50 p-2 text-white hover:text-gray-300" aria-label="Nächstes Bild">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function isValidImageUrl(url: string): boolean {
  try {
    new URL(url);
    return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url) || url.includes('images.') || url.includes('img.');
  } catch {
    return false;
  }
}

function ImageUploadModal({ onClose, onFile, onUrl }: { onClose: () => void; onFile: (f: File) => Promise<void>; onUrl: (u: string) => Promise<void> }) {
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [previewOk, setPreviewOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const validUrl = isValidImageUrl(url.trim());

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Bitte wählen Sie eine Bilddatei aus.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Die Datei ist zu groß (max. 10MB).');
      return;
    }
    setError(null);
    setFile(f);
  };

  const confirm = async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'file' && file) await onFile(file);
      else if (tab === 'url' && validUrl) await onUrl(url.trim());
    } catch (e) {
      setError((e as Error).message || 'Fehler beim Hinzufügen des Bildes');
    } finally {
      setLoading(false);
    }
  };

  const tabCls = (on: boolean) =>
    'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ' +
    (on ? 'bg-white text-orange-600 shadow-sm dark:bg-gray-800 dark:text-orange-400' : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mx-4 w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bild hinzufügen</h3>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200" aria-label="Schließen">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6">
          <div className="mb-6 flex space-x-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
            <button className={tabCls(tab === 'file')} onClick={() => setTab('file')}>Datei hochladen</button>
            <button className={tabCls(tab === 'url')} onClick={() => setTab('url')}>URL eingeben</button>
          </div>
          {tab === 'file' ? (
            <div
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pick(e.dataTransfer.files?.[0]);
              }}
              className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-orange-400 dark:border-gray-600 dark:hover:border-orange-500"
            >
              {file ? (
                <>
                  <svg className="mx-auto mb-2 h-8 w-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <p className="mb-2 text-gray-600 dark:text-gray-400"><span className="font-medium">{file.name}</span></p>
                  <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </>
              ) : (
                <>
                  <svg className="mx-auto mb-4 h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <p className="mb-2 text-gray-600 dark:text-gray-400"><span className="font-medium">Klicken Sie hier</span> oder ziehen Sie eine Datei hierher</p>
                  <p className="text-sm text-gray-500 dark:text-gray-500">PNG, JPG, JPEG oder WEBP (max. 10MB)</p>
                </>
              )}
              <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="image-url" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Bild-URL</label>
                <input
                  id="image-url"
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setPreviewOk(false);
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              {validUrl && (
                <div className={previewOk ? '' : 'hidden'}>
                  <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Vorschau:</p>
                  <img src={url.trim()} alt="Vorschau" onLoad={() => setPreviewOk(true)} onError={() => setError('Bild konnte nicht geladen werden. Bitte überprüfen Sie die URL.')} className="h-32 w-full rounded-md border object-cover" />
                </div>
              )}
            </div>
          )}
          {loading && (
            <div className="py-4 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500" />
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Bild wird hochgeladen...</p>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-6 flex justify-end space-x-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button onClick={onClose} className="rounded-md border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">Abbrechen</button>
            <button onClick={confirm} disabled={loading || (tab === 'file' ? !file : !validUrl)} className="rounded-md border border-transparent bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">Hinzufügen</button>
          </div>
        </div>
      </div>
    </div>
  );
}
