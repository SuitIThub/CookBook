/**
 * Shopping-list item notes — ports of the website's ViewNotesModal,
 * AddNoteModal (TinyMCE) and ImageGalleryModal.
 *
 * Large notes are not part of the sync payload (they can embed multi-MB
 * images); such items carry `noteRef` and the note is fetched from the server
 * on demand. Small notes are available offline.
 */
import { useEffect, useRef, useState } from 'react';
import type { ShoppingListItem } from '@/types';
import { apiBase, apiGet } from '@/lib/api';
import { loadTinymce, tinymceSkin } from '@/lib/tinymce';

const MAX_NOTE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_BYTES = 2 * 1024 * 1024;

/** Note HTML stores server-relative image paths (/uploads/…) like the website. */
export function noteForDisplay(html: string): string {
  const base = apiBase();
  return base ? html.replace(/(src=["'])\/uploads\//g, `$1${base}/uploads/`) : html;
}
function noteForStorage(html: string): string {
  const base = apiBase();
  return base ? html.split(`${base}/uploads/`).join('/uploads/') : html;
}

/** Resolve an item's note: inline, or fetched from the server when stripped. */
export async function resolveNote(listId: string, item: ShoppingListItem): Promise<string | null> {
  if (item.note != null) return item.note;
  if (!item.noteRef) return null;
  const r = await apiGet<{ note: string | null }>(
    `/api/shopping-lists/item-note?listId=${encodeURIComponent(listId)}&itemId=${encodeURIComponent(item.id)}`,
    { timeoutMs: 30000 }
  );
  return r.note;
}

export const hasNote = (i: ShoppingListItem) => !!i.noteRef || (!!i.note && i.note.trim() !== '');

/* ------------------------------------------------------------- View notes */

export function ViewNotesModal({ listId, items, onClose }: { listId: string; items: ShoppingListItem[]; onClose: () => void }) {
  const [notes, setNotes] = useState<Record<string, string | null | { error: string }>>({});
  useEffect(() => {
    let cancelled = false;
    for (const it of items) {
      resolveNote(listId, it)
        .then((n) => !cancelled && setNotes((s) => ({ ...s, [it.id]: n })))
        .catch(() => !cancelled && setNotes((s) => ({ ...s, [it.id]: { error: 'Diese Notiz ist nur online abrufbar.' } })));
    }
    return () => {
      cancelled = true;
    };
  }, [listId, items]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="modal-overlay absolute inset-0" onClick={onClose} />
      <div className="modal-content modal-wide relative mx-4 flex max-h-[90vh] flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="modal-header flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h2 className="modal-title text-lg font-medium text-gray-900 dark:text-white">Notizen</h2>
          <button type="button" className="modal-close text-2xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={onClose} aria-label="Schließen">&times;</button>
        </div>
        <div className="modal-body flex-1 space-y-4 overflow-y-auto p-4">
          {items.map((item) => {
            const n = notes[item.id];
            const label = item.name + (item.description ? ` • ${item.description}` : '');
            return (
              <div key={item.id} className="border-b border-gray-200 pb-4 last:border-b-0 last:pb-0 dark:border-gray-700">
                <div className="mb-2 font-medium text-gray-900 dark:text-white">{label}</div>
                {n === undefined ? (
                  <p className="text-muted text-sm">Lade Notiz …</p>
                ) : n && typeof n === 'object' ? (
                  <p className="text-sm italic text-red-600 dark:text-red-400">{n.error}</p>
                ) : n && n.trim() ? (
                  <div className="note-content prose prose-sm max-w-none text-gray-700 dark:prose-invert dark:text-gray-300 [&_img]:h-auto [&_img]:max-w-full [&_img]:object-contain" dangerouslySetInnerHTML={{ __html: noteForDisplay(n) }} />
                ) : (
                  <p className="text-muted text-sm italic">Keine Notiz</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="modal-footer border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn btn-secondary modal-close" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Add note */

export function AddNoteModal({
  listId,
  items,
  onClose,
  onSave
}: {
  listId: string;
  items: ShoppingListItem[];
  onClose: () => void;
  /** Persist the note (undefined = remove) for one item. */
  onSave: (itemId: string, note: string | undefined) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const galleryCb = useRef<((url: string) => void) | null>(null);
  const item = items.find((i) => i.id === selectedId) ?? items[0];

  // Init TinyMCE once.
  useEffect(() => {
    let disposed = false;
    const dark = document.documentElement.classList.contains('dark');
    (async () => {
      const [tinymce, skin] = await Promise.all([loadTinymce(), tinymceSkin(dark)]);
      if (disposed || !textareaRef.current) return;
      let style = document.getElementById('tinymce-skin') as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement('style');
        style.id = 'tinymce-skin';
        document.head.appendChild(style);
      }
      style.textContent = skin.ui;
      const height = containerRef.current ? Math.max(120, Math.round(containerRef.current.getBoundingClientRect().height)) : 280;
      const [editor] = await tinymce.init({
        target: textareaRef.current,
        plugins: 'lists link image code',
        toolbar: 'undo redo | bold italic | bullist numlist | link image gallery | code',
        menubar: false,
        height,
        resize: false,
        skin: false,
        content_css: false,
        promotion: false,
        branding: false,
        convert_urls: false,
        paste_data_images: true,
        content_style:
          skin.contentUi +
          '\n' +
          skin.content +
          (dark
            ? '\nbody { font-family: inherit; font-size: 14px; background-color: #1f2937; color: #f3f4f6; } body img { max-width: 100%; height: auto; object-fit: contain; }'
            : '\nbody { font-family: inherit; font-size: 14px; } body img { max-width: 100%; height: auto; object-fit: contain; }'),
        images_upload_handler: (blobInfo: any) =>
          new Promise((resolve, reject) => {
            if (blobInfo.blob().size > MAX_NOTE_IMAGE_BYTES) {
              reject({ message: 'Bild ist zu groß (max. 2 MB). Bitte verkleinern.', remove: true });
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blobInfo.blob());
          }),
        setup: (ed: any) => {
          ed.ui.registry.addIcon(
            'gallery',
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
          );
          ed.ui.registry.addButton('gallery', {
            icon: 'gallery',
            tooltip: 'Bild aus Galerie (Rezepte / Notizen)',
            onAction: () => {
              galleryCb.current = (url) => ed.insertContent('<img src="' + url.replace(/"/g, '&quot;') + '" alt="" />');
              setGallery(true);
            }
          });
        }
      });
      if (disposed) {
        editor?.remove();
        return;
      }
      editorRef.current = editor;
    })().catch((e) => setLoadError(String(e)));
    return () => {
      disposed = true;
      editorRef.current?.remove();
      editorRef.current = null;
    };
  }, []);

  // Load the selected item's note into the editor.
  const [noteLoaded, setNoteLoaded] = useState(false);
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setNoteLoaded(false);
    setError(null);
    resolveNote(listId, item)
      .then((n) => {
        if (cancelled) return;
        const html = noteForDisplay(n ?? '');
        const apply = () => {
          if (editorRef.current) editorRef.current.setContent(html);
          else if (textareaRef.current) textareaRef.current.value = html;
        };
        apply();
        // Editor may still be initialising.
        setTimeout(apply, 400);
        setNoteLoaded(true);
      })
      .catch(() => !cancelled && setError('Diese Notiz enthält große Inhalte und kann nur online bearbeitet werden.'));
    return () => {
      cancelled = true;
    };
  }, [listId, item?.id]);

  const save = async () => {
    if (!item || !noteLoaded) return;
    const content = editorRef.current ? editorRef.current.getContent() : textareaRef.current?.value || '';
    const trimmed = noteForStorage((content || '').trim());
    if (new Blob([trimmed]).size > MAX_NOTE_BYTES) {
      alert('Die Notiz ist zu groß (max. 2 MB). Bitte eingefügte Bilder verkleinern oder entfernen.');
      return;
    }
    setSaving(true);
    editorRef.current?.mode.set('readonly');
    try {
      await onSave(item.id, trimmed || undefined);
      onClose();
    } catch (e) {
      alert('Fehler beim Speichern der Notiz');
      editorRef.current?.mode.set('design');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="modal-overlay absolute inset-0" onClick={() => !saving && onClose()} />
      <div className="modal-content modal-wide relative mx-4 flex h-[80vh] max-h-[80vh] flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800">
        {saving && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-lg bg-white/90 dark:bg-gray-800/90">
            <p className="font-medium text-gray-700 dark:text-gray-200">Wird gespeichert...</p>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
              <div className="add-note-progress-bar h-full rounded-full bg-orange-500 dark:bg-orange-400" />
            </div>
          </div>
        )}
        <div className="modal-header flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h2 className="modal-title text-lg font-medium text-gray-900 dark:text-white">Notiz hinzufügen</h2>
          <button type="button" disabled={saving} className="modal-close text-2xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={onClose} aria-label="Schließen">&times;</button>
        </div>
        <div className="modal-body flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4">
          {items.length > 1 && (
            <div className="flex-shrink-0">
              <label htmlFor="add-note-item-select" className="form-label">Notiz für</label>
              <select id="add-note-item-select" className="form-input w-full" value={selectedId} disabled={saving} onChange={(e) => setSelectedId(e.target.value)}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name + (i.description ? ' • ' + i.description : '')}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            <label className="form-label flex-shrink-0">Notiz (Formatierung und Bilder möglich)</label>
            {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {loadError && <p className="mb-2 text-sm text-red-600 dark:text-red-400">Editor konnte nicht geladen werden.</p>}
            <div ref={containerRef} className="min-h-[120px] flex-1 overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
              <textarea ref={textareaRef} className="form-textarea h-full min-h-[120px] w-full resize-none border-0 bg-white p-3 text-gray-900 dark:bg-gray-700 dark:text-gray-100" placeholder="Notiz eingeben..." />
            </div>
          </div>
        </div>
        <div className="modal-footer flex gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn btn-secondary modal-close" disabled={saving} onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn btn-success" disabled={saving || !noteLoaded || !!error} onClick={save}>Speichern</button>
        </div>
      </div>
      {gallery && (
        <ImageGalleryModal
          onClose={() => setGallery(false)}
          onSelect={(url) => {
            galleryCb.current?.(url);
            setGallery(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Image gallery */

interface GalleryData {
  recipeImages?: { url: string; recipeTitle?: string }[];
  noteImages?: { url: string }[];
}

export function ImageGalleryModal({ onClose, onSelect }: { onClose: () => void; onSelect: (url: string) => void }) {
  const [data, setData] = useState<GalleryData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    apiGet<GalleryData>('/api/images/gallery').then(setData, () => setFailed(true));
  }, []);
  const abs = (u: string) => (u.startsWith('/') ? `${apiBase()}${u}` : u);
  const grid = (imgs: { url: string; recipeTitle?: string }[]) => (
    <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
      {imgs.map((it) => (
        <button
          key={it.url}
          type="button"
          title={it.recipeTitle || it.url}
          onClick={() => onSelect(abs(it.url))}
          className="block aspect-square w-full overflow-hidden rounded-lg border-2 border-transparent bg-gray-100 hover:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:hover:border-orange-400"
        >
          <img src={abs(it.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
  return (
    <div className="modal fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
      <div className="modal-overlay absolute inset-0" onClick={onClose} />
      <div className="modal-content modal-wide relative mx-4 flex max-h-[85vh] flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="modal-header flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h2 className="modal-title text-lg font-medium text-gray-900 dark:text-white">Bild aus Galerie wählen</h2>
          <button type="button" className="modal-close text-2xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={onClose} aria-label="Schließen">&times;</button>
        </div>
        <div className="modal-body flex-1 overflow-y-auto p-4">
          {failed ? (
            <p className="text-sm text-red-600 dark:text-red-400">Galerie konnte nicht geladen werden.</p>
          ) : !data ? (
            <div className="py-8 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500" />
              <p className="text-muted mt-2">Galerie wird geladen...</p>
            </div>
          ) : (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Aus Rezepten</h3>
                {data.recipeImages?.length ? grid(data.recipeImages) : <p className="text-muted text-sm">Keine Rezeptbilder vorhanden.</p>}
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Aus anderen Notizen</h3>
                {data.noteImages?.length ? grid(data.noteImages) : <p className="text-muted text-sm">Keine Bilder aus Notizen vorhanden.</p>}
              </section>
            </div>
          )}
        </div>
        <div className="modal-footer border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn btn-secondary modal-close" onClick={onClose}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
