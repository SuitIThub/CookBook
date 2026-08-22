import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

interface Props {
  onDetected: (ean: string) => void;
  onClose: () => void;
}

/**
 * Barcode scanner. On a device it uses the native ML Kit scanner
 * (@capacitor-mlkit/barcode-scanning); in a browser it falls back to the
 * BarcodeDetector API over a camera preview. Camera flows can't be verified
 * headless — test on device.
 */
export default function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'error'>('starting');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    async function runNative() {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
      try {
        const perm = await BarcodeScanner.requestPermissions();
        if (perm.camera !== 'granted' && perm.camera !== 'limited') {
          setStatus('error');
          setMessage('Kamerazugriff verweigert.');
          return;
        }
        const { barcodes } = await BarcodeScanner.scan();
        if (cancelled) return;
        const code = barcodes[0]?.rawValue;
        if (code) onDetected(code);
        else onClose();
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setMessage((e as Error).message);
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
        const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus('scanning');
        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length && codes[0].rawValue) {
              onDetected(codes[0].rawValue);
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
    };
  }, [onDetected, onClose]);

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
          {status === 'scanning' && 'Barcode ins Bild halten.'}
          {status === 'unsupported' &&
            'Barcode-Scan wird in diesem Browser nicht unterstützt. Auf dem Gerät nutzt die App die native Kamera; sonst EAN manuell eingeben.'}
          {status === 'error' && `Fehler: ${message}`}
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
