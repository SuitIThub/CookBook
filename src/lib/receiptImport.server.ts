/**
 * Receipt / invoice import (server-only), run as a background job:
 *   1. read the receipt (images and/or PDFs) with the "Bilder lesen" task:
 *      OpenRouter vision (images + PDFs directly), Ollama vision (images; PDFs
 *      rasterised with pdftoppm) or local OCR (tesseract; PDF text layer via
 *      pdftotext) + the "Zuordnen" text model for the structure
 *   2. lines → products: learned line texts per supermarket, fuzzy match
 *      against the register (lib/receiptMatch.ts), then the "Zuordnen" model
 *   3. the user reviews; /api/receipts/commit saves prices, history, aliases
 * Uploaded files are deleted as soon as the job finished.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, receiptStore } from './database.server';
import { aiStructured, visionStructured, type AIRequestConfig } from './ai';
import { TASK_DEFAULTS, type VisionMode } from './aiTasks';
import { confidentMatch, fold, rankProducts } from './receiptMatch';
import { bin, run } from './proc.server';

export interface ReceiptLine {
  text: string;
  quantity: number;
  unit: 'stk' | 'kg';
  /** Regular price per piece / per kg (before discounts). */
  unitPrice: number;
  discount: number;
  /** Amount actually paid for the line. */
  total: number;
  deposit: boolean;
}

export type LineConfidence = 'gelernt' | 'sicher' | 'vorschlag' | 'ki' | 'keine' | 'ignoriert';

export interface ReviewLine extends ReceiptLine {
  productId: string | null;
  ignore: boolean;
  confidence: LineConfidence;
  reason: string;
  /** Fuzzy candidates for the picker. */
  candidates: { id: string; name: string; score: number }[];
}

export interface ReceiptResult {
  store: string;
  date: string;
  /** Detected/selected supermarket (null = unknown → user picks or creates). */
  supermarketId: string | null;
  lines: ReviewLine[];
  total: number | null;
}

/* ---------------------------------------------------------------- jobs */

export interface ReceiptJob {
  id: string;
  stage: 'read' | 'match' | 'done' | 'error';
  message: string;
  result?: ReceiptResult;
  error?: string;
  createdAt: number;
}
const jobs = new Map<string, ReceiptJob>();

export function getReceiptJob(id: string): ReceiptJob | undefined {
  return jobs.get(id);
}

export interface ReceiptOptions {
  vision: { mode: VisionMode; model: string };
  /** Text model for OCR'd/PDF text and matching ("Zuordnen"). */
  textAi: AIRequestConfig;
  openRouterApiKey?: string;
  supermarketId?: string | null;
}

export function startReceiptImport(files: { name: string; mime: string; data: Buffer }[], options: ReceiptOptions): ReceiptJob {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
  const job: ReceiptJob = { id: randomUUID(), stage: 'read', message: 'Beleg wird gelesen …', createdAt: Date.now() };
  jobs.set(job.id, job);
  void analyzeReceipt(files, options, (stage, message) => Object.assign(job, { stage, message }))
    .then((result) => Object.assign(job, { stage: 'done', message: 'Fertig', result }))
    .catch((e) => {
      console.error('Receipt import failed:', e);
      Object.assign(job, { stage: 'error', message: 'Fehlgeschlagen', error: (e as Error).message || String(e) });
    });
  return job;
}

/* ------------------------------------------------------------- reading */

const LINE_SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string' },
    date: { type: 'string' },
    total: { type: 'number' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string', enum: ['stk', 'kg'] },
          unitPrice: { type: 'number' },
          discount: { type: 'number' },
          total: { type: 'number' },
          deposit: { type: 'boolean' }
        },
        required: ['text', 'quantity', 'unit', 'unitPrice', 'total', 'deposit']
      }
    }
  },
  required: ['lines']
};

const READ_RULES = `Gib jeden gekauften Posten als eine Zeile zurück:
- text: Postentext GENAU wie auf dem Beleg (Abkürzungen nicht auflösen, keine Preise).
- quantity: Anzahl ("2 x 1,99" → 2) bzw. Gewicht in kg bei gewogener Ware ("0,512 kg x 3,49 EUR/kg" → 0.512).
- unit: "stk" oder "kg" (gewogene Ware).
- unitPrice: REGULÄRER Preis pro Stück bzw. pro kg VOR Rabatten.
- discount: Rabatt in EUR auf diesen Posten als positive Zahl, sonst 0. Rabatt-/Aktions-/Couponzeilen und negative Beträge direkt unter einem Posten NICHT als eigene Zeile ausgeben, sondern beim Posten darüber verrechnen.
- total: tatsächlich bezahlter Betrag für den Posten.
- deposit: true für Pfand und Leergut, sonst false.
Keine Zwischensummen, Summen, Zahlungsarten, MwSt.- oder Bonuszeilen.
store: Name des Geschäfts (z. B. "REWE", "Aldi Süd", "Lidl"). date: Kaufdatum als YYYY-MM-DD. total: Gesamtsumme.
Gehören mehrere Bilder zum selben Beleg, überlappende Posten nur einmal ausgeben.`;

type Extract = { store?: string; date?: string; total?: number; lines?: Partial<ReceiptLine>[] };

async function readReceipt(files: { name: string; mime: string; data: Buffer }[], o: ReceiptOptions, work: string): Promise<Extract> {
  const mode = o.vision.mode;
  if (mode === 'openrouter') {
    const model = o.vision.model || TASK_DEFAULTS.vision.model;
    return visionStructured<Extract>(`Lies diesen Kassenbon bzw. diese Rechnung eines Supermarkts.\n${READ_RULES}`, LINE_SCHEMA, files.map((f) => ({ name: f.name, mime: f.mime, base64: f.data.toString('base64') })), 'openrouter', model, o.openRouterApiKey);
  }
  // Ollama / OCR need images; PDFs with a text layer can skip OCR entirely.
  const images: { name: string; mime: string; data: Buffer }[] = [];
  const texts: string[] = [];
  for (const [i, f] of files.entries()) {
    if (f.mime !== 'application/pdf') {
      images.push(f);
      continue;
    }
    const pdf = join(work, `doc${i}.pdf`);
    await writeFile(pdf, f.data);
    const text = await run(bin(process.env.PDFTOTEXT_BIN, 'pdftotext'), ['-layout', pdf, '-']).then((r) => r.stdout).catch(() => '');
    if (text.replace(/\s/g, '').length > 40) {
      texts.push(text);
      continue;
    }
    await run(bin(process.env.PDFTOPPM_BIN, 'pdftoppm'), ['-r', '150', '-png', pdf, join(work, `page${i}`)]);
    for (const page of (await readdir(work)).filter((n) => n.startsWith(`page${i}`)).sort()) {
      images.push({ name: page, mime: 'image/png', data: await readFile(join(work, page)) });
    }
  }
  if (mode === 'ollama' && images.length) {
    const model = o.vision.model || TASK_DEFAULTS.vision.model;
    const fromImages = await visionStructured<Extract>(`Lies diesen Kassenbon bzw. diese Rechnung eines Supermarkts.\n${READ_RULES}`, LINE_SCHEMA, images.map((f) => ({ name: f.name, mime: f.mime, base64: f.data.toString('base64') })), 'ollama', model);
    if (!texts.length) return fromImages;
    texts.unshift(JSON.stringify(fromImages));
  } else {
    // OCR (also "none": receipts can't be read without some image reading)
    const tesseract = bin(process.env.TESSERACT_BIN, 'tesseract');
    for (const [i, img] of images.entries()) {
      const path = join(work, `ocr${i}${img.mime === 'image/png' ? '.png' : '.jpg'}`);
      await writeFile(path, img.data);
      texts.push((await run(tesseract, [path, 'stdout', '-l', 'deu+eng', '--psm', '4'], { timeoutMs: 90_000 })).stdout);
    }
  }
  if (!texts.length) throw new Error('Im Beleg wurde kein Text gefunden.');
  return aiStructured<Extract>(`Strukturiere diesen Kassenbon bzw. diese Rechnung (Text per Texterkennung, kann Lesefehler enthalten).\n${READ_RULES}\n\nTEXT:\n${texts.join('\n\n---\n\n').slice(0, 20000)}`, LINE_SCHEMA, o.textAi);
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function cleanLines(ex: Extract): ReceiptLine[] {
  return (ex.lines ?? [])
    .filter((l) => typeof l?.text === 'string' && l.text.trim())
    .map((l) => {
      const unit = l.unit === 'kg' ? 'kg' : 'stk';
      const quantity = num(l.quantity, 1) || 1;
      const total = num(l.total);
      const discount = Math.abs(num(l.discount));
      // Fall back to total/quantity when the model left the unit price out.
      const unitPrice = num(l.unitPrice) || (quantity ? Math.round(((total + discount) / quantity) * 100) / 100 : total);
      return { text: l.text!.trim(), quantity, unit, unitPrice, discount, total, deposit: !!l.deposit || /PFAND|LEERGUT/i.test(l.text!) };
    });
}

/* ------------------------------------------------------------ matching */

function detectSupermarket(store: string): string | null {
  const s = fold(store);
  if (!s) return null;
  const hit = db.getAllSupermarkets().find((m) => {
    const n = fold(m.name);
    return n && (s.includes(n) || n.includes(s));
  });
  return hit?.id ?? null;
}

async function analyzeReceipt(
  files: { name: string; mime: string; data: Buffer }[],
  o: ReceiptOptions,
  set: (stage: ReceiptJob['stage'], message: string) => void
): Promise<ReceiptResult> {
  const work = await mkdtemp(join(tmpdir(), 'cookbook-receipt-'));
  try {
    const ex = await readReceipt(files, o, work);
    const lines = cleanLines(ex);
    if (!lines.length) throw new Error('Auf dem Beleg wurden keine Posten erkannt.');
    set('match', 'Posten werden Produkten zugeordnet …');

    const supermarketId = o.supermarketId || detectSupermarket(ex.store ?? '');
    const products = db.getAllProducts();
    const review: ReviewLine[] = lines.map((line) => {
      const ranked = rankProducts(line.text, products);
      const candidates = ranked.map((r) => ({ id: r.product.id, name: r.product.brand ? `${r.product.brand} – ${r.product.name}` : r.product.name, score: r.score }));
      const base = { ...line, candidates };
      if (line.deposit) return { ...base, productId: null, ignore: true, confidence: 'ignoriert', reason: 'Pfand/Leergut' };
      const learned = supermarketId ? receiptStore.alias(supermarketId, line.text) : null;
      if (learned && (learned.ignore || (learned.productId && products.some((p) => p.id === learned.productId)))) {
        return { ...base, productId: learned.productId, ignore: learned.ignore, confidence: 'gelernt', reason: 'Bekannter Posten dieses Supermarkts.' };
      }
      const fuzzy = confidentMatch(ranked);
      if (fuzzy) {
        const score = ranked[0].score;
        return { ...base, productId: fuzzy.id, ignore: false, confidence: score >= 0.9 ? 'sicher' : 'vorschlag', reason: `Ähnlicher Produktname (${Math.round(score * 100)} %).` };
      }
      return { ...base, productId: null, ignore: false, confidence: 'keine', reason: '' };
    });

    // AI for the rest: pick among the closest register products, or mark non-products.
    const open = review.map((r, i) => (r.confidence === 'keine' ? i : -1)).filter((i) => i >= 0);
    if (open.length) {
      const pool = products.length <= 150 ? products : [...new Map(open.flatMap((i) => rankProducts(review[i].text, products, 8).map((r) => [r.product.id, r.product]))).values()];
      const prompt = `Ordne jede Zeile eines Kassenbons dem passenden Produkt aus dem Produktregister zu. Die Bontexte sind abgekürzt (z. B. "GOUDA JG 400G" = Gouda jung 400 g).
Gib productId "" zurück, wenn kein Produkt sicher passt. isProduct=false für Zeilen, die kein Lebensmittel/Produkt fürs Kochbuch sind (Tragetasche, Gutschein, Non-Food).

PRODUKTREGISTER (id: Name):
${pool.map((p) => `${p.id}: ${p.brand ? `${p.brand} – ` : ''}${p.name}${p.netGrams ? ` (${p.netGrams} g)` : ''}`).join('\n') || '(leer)'}

BONZEILEN:
${open.map((i) => `${i}: ${review[i].text}`).join('\n')}`;
      try {
        const answer = await aiStructured<{ matches?: { index: number; productId: string; isProduct: boolean }[] }>(
          prompt,
          {
            type: 'object',
            properties: {
              matches: {
                type: 'array',
                items: { type: 'object', properties: { index: { type: 'number' }, productId: { type: 'string' }, isProduct: { type: 'boolean' } }, required: ['index', 'productId', 'isProduct'] }
              }
            },
            required: ['matches']
          },
          o.textAi
        );
        for (const m of answer.matches ?? []) {
          if (!open.includes(m.index)) continue;
          const r = review[m.index];
          if (m.productId && products.some((p) => p.id === m.productId)) {
            Object.assign(r, { productId: m.productId, confidence: 'ki', reason: 'KI-Vorschlag.' });
          } else if (m.isProduct === false) {
            Object.assign(r, { ignore: true, confidence: 'ki', reason: 'KI: kein Produkt fürs Kochbuch.' });
          }
        }
      } catch (error) {
        for (const i of open) review[i].reason = `KI-Zuordnung fehlgeschlagen: ${(error as Error).message.slice(0, 120)}`;
      }
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(ex.date ?? '') ? ex.date! : new Date().toISOString().slice(0, 10);
    return { store: (ex.store ?? '').trim(), date, supermarketId, lines: review, total: typeof ex.total === 'number' ? ex.total : null };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
