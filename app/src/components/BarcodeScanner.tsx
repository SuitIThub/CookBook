import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

interface Props {
  onDetected: (ean: string) => void;
  onClose: () => void;
}

/** Same code must be read this many times before it is accepted. */
const CONFIRMATIONS = 3;

/**
 * GTIN check-digit validation (EAN-13, EAN-8, UPC-A). A barcode that is only
 * partly in the frame can decode to a wrong number; the check digit (plus the
 * repeated-read confirmation) filters those out. UPC-E has its check digit on
 * the expanded form, so it only gets the confirmation.
 */
export function isValidGtin(code: string, format?: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (format && /upc_?e/i.test(format)) return code.length === 6 || code.length === 8;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

/** Counts reads per code; returns the code once it was seen often enough. */
function confirmer() {
  const seen = new Map<string, number>();
  return (code: string, format?: string): string | null => {
    if (!isValidGtin(code, format)) return null;
    const n = (seen.get(code) ?? 0) + 1;
    seen.set(code, n);
    return n >= CONFIRMATIONS ? code : null;
  };
}

/**
 * Barcode scanner. On a device it uses ML Kit in live mode
 * (@capacitor-mlkit/barcode-scanning startScan: camera behind a transparent
 * WebView, our overlay on top) so every frame can be checked; in a browser it
 * falls back to the BarcodeDetector API over a camera preview. Both only accept
 * product barcodes with a valid check digit that were read repeatedly.
 */
export default function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'error'>('starting');
  const [message, setMessage] = useState('');
  const [nativeLive, setNativeLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopNative: (() => Promise<void>) | null = null;

    const setTransparent = (on: boolean) => {
      document.documentElement.classList.toggle('barcode-scanner-active', on);
      document.body.classList.toggle('barcode-scanner-active', on);
    };

    async function runNative() {
      const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
      const formats = [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE];
      try {
        const perm = await BarcodeScanner.requestPermissions();
        if (perm.camera !== 'granted' && perm.camera !== 'limited') {
          setStatus('error');
          setMessage('Kamerazugriff verweigert.');
          return;
        }
      } catch (e) {
        setStatus('error');
        setMessage((e as Error).message);
        return;
      }
      if (cancelled) return;

      const confirm = confirmer();
      let done = false;
      try {
        const listener = await BarcodeScanner.addListener('barcodesScanned', (ev) => {
          if (done || cancelled) return;
          for (const b of ev.barcodes ?? []) {
            const code = confirm((b.rawValue || '').trim(), String(b.format ?? ''));
            if (code) {
              done = true;
              void stopNative?.().then(() => onDetected(code));
              return;
            }
          }
        });
        stopNative = async () => {
          stopNative = null;
          setTransparent(false);
          await listener.remove().catch(() => {});
          await BarcodeScanner.stopScan().catch(() => {});
        };
        setTransparent(true);
        setNativeLive(true);
        setStatus('scanning');
        await BarcodeScanner.startScan({ formats });
      } catch {
        // Live mode unavailable → one-shot Google scanner, validated; retry on a bad read.
        await stopNative?.();
        setNativeLive(false);
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          try {
            const { barcodes } = await BarcodeScanner.scan({ formats });
            if (cancelled) return;
            const b = barcodes[0];
            if (!b) return onClose();
            const code = (b.rawValue || '').trim();
            if (isValidGtin(code, String(b.format ?? ''))) return onDetected(code);
            setMessage(`Ungültiger Code gelesen (${code}) — bitte erneut scannen.`);
          } catch (e) {
            if (!cancelled) {
              setStatus('error');
              setMessage((e as Error).message);
            }
            return;
          }
        }
      }
    }

    async function runWeb() {
      const BD = (window as any).BarcodeDetector;
      if (!BD) {
        setStatus('unsupported');
        return;
      }
      try {
        const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus('scanning');
        const confirm = confirmer();
        const tick = async () => {
          if (cancelled) return;
          try {
            for (const c of await detector.detect(video)) {
              const code = confirm(String(c.rawValue || '').trim(), c.format);
              if (code) {
                onDetected(code);
                return;
              }
            }
          } catch {
            /* transient */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setStatus('error');
        setMessage((e as Error).message);
      }
    }

    if (Capacitor.isNativePlatform()) runNative();
    else runWeb();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void stopNative?.();
    };
  }, [onDetected, onClose]);

  if (nativeLive) {
    // Camera renders natively behind the (transparent) WebView; only this overlay is visible.
    return (
      <div className="barcode-scanner-ui fixed inset-0 z-[60] flex flex-col items-center justify-between p-6">
        <p className="mt-10 rounded-lg bg-black/60 px-4 py-2 text-center text-sm text-white">
          Barcode vollständig in den Rahmen halten.
          {message && <span className="mt-1 block text-xs text-yellow-300">{message}</span>}
        </p>
        <div className="aspect-[3/2] w-full max-w-sm rounded-xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        <button onClick={onClose} className="mb-6 rounded-lg bg-white px-6 py-3 text-sm font-medium text-gray-900 shadow-lg">
          Abbrechen
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl dark:bg-secondary-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">Barcode scannen</h2>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {status === 'scanning' && (
            <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-primary-500/80" />
          )}
        </div>
        <p className="mt-3 text-sm text-secondary-500">
          {status === 'starting' && 'Kamera wird gestartet …'}
          {status === 'scanning' && 'Barcode vollständig ins Bild halten.'}
          {status === 'unsupported' &&
            'Barcode-Scan wird in diesem Browser nicht unterstützt. Auf dem Gerät nutzt die App die native Kamera; sonst EAN manuell eingeben.'}
          {status === 'error' && `Fehler: ${message}`}
          {status !== 'error' && message && <span className="mt-1 block text-xs text-amber-600">{message}</span>}
        </p>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600">
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
