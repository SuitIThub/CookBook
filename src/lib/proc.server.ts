/** Run an external tool (ffmpeg, tesseract, pdftotext, …) with a timeout; UTF-8 output. */
import { spawn } from 'node:child_process';

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    // Decode as UTF-8 across chunk boundaries (umlauts in transcripts/OCR).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 4 * 60 * 1000);
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error(`„${cmd}“ ist auf dem Server nicht installiert.`) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} fehlgeschlagen (Code ${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

/** Configured binary (env override) or the default name on PATH. */
export const bin = (env: string | undefined, fallback: string) => (env && env.trim()) || fallback;
