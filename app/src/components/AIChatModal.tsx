import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  streamChat,
  clearChat,
  stripMarkers,
  detectVariantMarker,
  detectEditMarker,
  proposeVariantFromMessage,
  proposeEdit,
  discardDraft,
  type ChatMessage,
  type EditProposal
} from '@/lib/aiChat';
import { runSync } from '@/lib/syncRunner';
import { saveLocalRecipe } from '@/lib/localData';
import { getAlias, getToken } from '@/lib/settings';

interface Props {
  recipeId: string;
  recipeTitle: string;
  onClose: () => void;
}

export default function AIChatModal({ recipeId, recipeTitle, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantBusy, setVariantBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editProposal, setEditProposal] = useState<EditProposal | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasToken = !!getAlias() && !!getToken();

  const requestEdit = async (message: string, regions: string[]) => {
    if (editBusy) return;
    setEditBusy(true);
    setError(null);
    try {
      const proposal = await proposeEdit(recipeId, message, regions);
      setEditProposal(proposal);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  };

  const cancelEdit = async () => {
    setEditProposal(null);
    await discardDraft(recipeId);
  };

  const applyEdit = async () => {
    const draft = editProposal?.draft;
    if (!draft) return;
    setEditBusy(true);
    setError(null);
    try {
      // Apply only the editable content fields onto the real recipe (local-first
      // write → sync pushes it to the server); then drop the server draft.
      await saveLocalRecipe(recipeId, {
        title: draft.title,
        subtitle: draft.subtitle,
        description: draft.description,
        metadata: draft.metadata,
        category: draft.category,
        tags: draft.tags,
        ingredientGroups: draft.ingredientGroups,
        preparationGroups: draft.preparationGroups
      });
      await runSync();
      await discardDraft(recipeId);
      setEditProposal(null);
      queryClient.invalidateQueries();
      onClose();
      navigate(`/rezept/${recipeId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  };

  const saveVariant = async (message: string) => {
    if (variantBusy) return;
    setVariantBusy(true);
    setError(null);
    try {
      const newId = await proposeVariantFromMessage(recipeId, message);
      await runSync();
      queryClient.invalidateQueries();
      onClose();
      navigate(`/rezept/${newId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVariantBusy(false);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput('');
    const history = messages;
    const nextUser: ChatMessage = { role: 'user', content: text };
    setMessages([...history, nextUser, { role: 'assistant', content: '' }]);
    setStreaming(true);
    try {
      await streamChat(
        { recipeId, message: text, history },
        {
          onDelta: (chunk) => {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + chunk };
              return copy;
            });
          }
        }
      );
    } catch (e) {
      setError((e as Error).message);
      // drop the empty/partial assistant bubble on hard failure
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[copy.length - 1]?.role === 'assistant' && !copy[copy.length - 1].content) copy.pop();
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  const clear = async () => {
    setMessages([]);
    setError(null);
    await clearChat(recipeId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="relative flex h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-secondary-800 sm:h-[75vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-secondary-200 p-4 dark:border-secondary-700">
          <div>
            <h2 className="text-lg font-semibold">KI-Chat</h2>
            <p className="text-xs text-secondary-500">{recipeTitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={clear} className="text-sm text-secondary-500 hover:underline" disabled={streaming}>
              Leeren
            </button>
            <button onClick={onClose} aria-label="Schließen" className="text-2xl leading-none text-secondary-400 hover:text-secondary-600">
              ×
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {!hasToken && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Für den KI-Chat ist ein Token nötig (Einstellungen). Provider/Modell werden serverseitig bzw. in den
              Einstellungen konfiguriert.
            </p>
          )}
          {messages.length === 0 && hasToken && (
            <p className="text-sm text-secondary-500">
              Frag die KI etwas zu diesem Rezept – z. B. „Mach eine vegetarische Variante" oder „Wie kann ich das
              gesünder machen?".
            </p>
          )}
          {messages.map((m, i) => {
            const display = m.role === 'assistant' ? stripMarkers(m.content) : m.content;
            const isLast = i === messages.length - 1;
            const canMakeVariant =
              m.role === 'assistant' && !streaming && detectVariantMarker(m.content) !== null;
            const editMarker = m.role === 'assistant' && !streaming ? detectEditMarker(m.content) : null;
            return (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <div
                  className={
                    'inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ' +
                    (m.role === 'user'
                      ? 'bg-primary-600 text-white'
                      : 'bg-secondary-100 text-secondary-900 dark:bg-secondary-700 dark:text-white')
                  }
                >
                  {display || (isLast && streaming ? '…' : '')}
                </div>
                {(canMakeVariant || editMarker) && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {canMakeVariant && (
                      <button
                        onClick={() => saveVariant(m.content)}
                        disabled={variantBusy}
                        className="rounded-lg border border-primary-500 px-3 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/30"
                      >
                        {variantBusy ? 'Erstelle Variante …' : '＋ Als Variante speichern'}
                      </button>
                    )}
                    {editMarker && (
                      <button
                        onClick={() => requestEdit(m.content, editMarker.regions)}
                        disabled={editBusy}
                        className="rounded-lg border border-primary-500 px-3 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/30"
                      >
                        {editBusy ? 'Prüfe Änderung …' : '✎ Änderung übernehmen'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        {editProposal && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={cancelEdit}>
            <div
              className="max-h-[80%] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-2xl dark:bg-secondary-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-2 text-base font-semibold">Änderung übernehmen?</h3>
              {editProposal.highlights.length === 0 ? (
                <p className="text-sm text-secondary-500">
                  {editProposal.diagnostics?.message ?? 'Keine konkreten Änderungen erkannt.'}
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {editProposal.highlights.map((h, i) => (
                    <li key={i} className="rounded-lg border border-secondary-200 p-2 dark:border-secondary-700">
                      <div className="mb-1 font-medium text-secondary-500">{h.path}</div>
                      {h.before && <div className="text-red-600 line-through dark:text-red-400">{h.before}</div>}
                      <div className="text-green-700 dark:text-green-400">{h.after}</div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={cancelEdit}
                  disabled={editBusy}
                  className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600"
                >
                  Verwerfen
                </button>
                <button
                  onClick={applyEdit}
                  disabled={editBusy || !editProposal.draft}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {editBusy ? 'Übernehme …' : 'Übernehmen'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-secondary-200 p-3 dark:border-secondary-700">
          <div className="flex items-end gap-2">
            <textarea
              className="max-h-32 flex-1 resize-none rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-600 dark:bg-secondary-900 dark:text-white"
              rows={1}
              placeholder="Nachricht …"
              value={input}
              disabled={streaming || !hasToken}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim() || !hasToken}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {streaming ? '…' : 'Senden'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
