import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { createConfirmer as confirmer, isValidGtin } from '@core/gtin';

interface Props {
  onDetected: (ean: string) => void;
  onClose: () => void;
  /** Keep scanning after a code (batch import); onClose ends it. */
  continuous?: boolean;
}

/** Continuous mode: ignore the code that is still in front of the camera. */
const REPEAT_MS = 4000;

/**
 * Barcode scanner. On a device it uses ML Kit in live mode
 * (@capacitor-mlkit/barcode-scanning startScan: camera behind a transparent
 * WebView, our overlay on top) so every frame can be checked; in a browser it
 * falls back to the BarcodeDetector API over a camera preview. Both only accept
 * product barcodes with a valid check digit that were read repeatedly.
 */
export default function BarcodeScanner({ onDetected, onClose, continuous = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'error'>('starting');
  const [message, setMessage] = useState('');
  const [nativeLive, setNativeLive] = useState(false);
  const [scanned, setScanned] = useState<{ count: number; last: string }>({ count: 0, last: '' });
  // The scanner runs once per mount; always call the latest callbacks.
  const cb = useRef({ onDetected, onClose });
  cb.current = { onDetected, onClose };

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
      const recent = new Map<string, number>();
      let done = false;
      try {
        const listener = await BarcodeScanner.addListener('barcodesScanned', (ev) => {
          if (done || cancelled) return;
          for (const b of ev.barcodes ?? []) {
            const code = confirm((b.rawValue || '').trim(), String(b.format ?? ''));
            if (!code) continue;
            if (continuous) {
              if (Date.now() - (recent.get(code) ?? 0) < REPEAT_MS) continue;
              recent.set(code, Date.now());
              navigator.vibrate?.(60);
              setScanned((s) => ({ count: s.count + 1, last: code }));
              cb.current.onDetected(code);
              continue;
            }
            done = true;
            void stopNative?.().then(() => cb.current.onDetected(code));
            return;
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
            if (!b) return cb.current.onClose();
            const code = (b.rawValue || '').trim();
            if (isValidGtin(code, String(b.format ?? ''))) return cb.current.onDetected(code);
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
        const recent = new Map<string, number>();
        const tick = async () => {
          if (cancelled) return;
          try {
            for (const c of await detector.detect(video)) {
              const code = confirm(String(c.rawValue || '').trim(), c.format);
              if (!code) continue;
              if (continuous) {
                if (Date.now() - (recent.get(code) ?? 0) < REPEAT_MS) continue;
                recent.set(code, Date.now());
                setScanned((s) => ({ count: s.count + 1, last: code }));
                cb.current.onDetected(code);
                continue;
              }
              cb.current.onDetected(code);
              return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous]);

  if (nativeLive) {
    // Camera renders natively behind the (transparent) WebView; only this overlay is visible.
    return (
      <div className="barcode-scanner-ui fixed inset-0 z-[60] flex flex-col items-center justify-between p-6">
        <p className="mt-10 rounded-lg bg-black/60 px-4 py-2 text-center text-sm text-white">
          Barcode vollständig in den Rahmen halten.
          {continuous && <span className="mt-1 block text-xs">{scanned.count ? `${scanned.count} gescannt — zuletzt ${scanned.last}` : 'Mehrere Produkte nacheinander scannen.'}</span>}
          {message && <span className="mt-1 block text-xs text-yellow-300">{message}</span>}
        </p>
        <div className="aspect-[3/2] w-full max-w-sm rounded-xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        <button onClick={onClose} className="mb-6 rounded-lg bg-white px-6 py-3 text-sm font-medium text-gray-900 shadow-lg">
          {continuous ? `Fertig${scanned.count ? ` (${scanned.count})` : ''}` : 'Abbrechen'}
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
          {status === 'scanning' && continuous && scanned.count > 0 && <span className="mt-1 block text-xs">{`${scanned.count} gescannt — zuletzt ${scanned.last}`}</span>}
          {status === 'unsupported' &&
            'Barcode-Scan wird in diesem Browser nicht unterstützt. Auf dem Gerät nutzt die App die native Kamera; sonst EAN manuell eingeben.'}
          {status === 'error' && `Fehler: ${message}`}
          {status !== 'error' && message && <span className="mt-1 block text-xs text-amber-600">{message}</span>}
        </p>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-secondary-300 px-4 py-2 text-sm dark:border-secondary-600">
            {continuous ? 'Fertig' : 'Schließen'}
          </button>
        </div>
      </div>
    </div>
  );
}
