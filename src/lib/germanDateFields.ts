const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const DATETIME_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})$/;

const MONTHS_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function formatGermanDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function formatGermanDateTime(isoLocal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(isoLocal.trim());
  if (!m) return isoLocal.includes('T') ? formatGermanDate(isoLocal.slice(0, 10)) : formatGermanDate(isoLocal);
  return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
}

export function parseGermanDate(value: string): string | null {
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseGermanDateTime(value: string): string | null {
  const trimmed = value.trim();
  const withTime = DATETIME_RE.exec(trimmed);
  if (withTime) {
    const date = parseGermanDate(`${withTime[1]}.${withTime[2]}.${withTime[3]}`);
    if (!date) return null;
    const hour = Number(withTime[4]);
    const minute = Number(withTime[5]);
    if (hour > 23 || minute > 59) return null;
    return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const dateOnly = parseGermanDate(trimmed);
  return dateOnly ? `${dateOnly}T00:00` : null;
}

const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function nativeToDisplay(native: HTMLInputElement): string {
  if (!native.value) return '';
  return native.type === 'datetime-local' ? formatGermanDateTime(native.value) : formatGermanDate(native.value);
}

function displayToNative(native: HTMLInputElement, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return native.type === 'datetime-local' ? parseGermanDateTime(trimmed) : parseGermanDate(trimmed);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

let openPopup: HTMLElement | null = null;
let openPopupCleanup: (() => void) | null = null;

function closeDateTimePicker(): void {
  openPopupCleanup?.();
  openPopupCleanup = null;
  openPopup?.remove();
  openPopup = null;
}

function parseNativeDateTime(value: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) {
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    hour: m[4] != null ? Number(m[4]) : now.getHours(),
    minute: m[5] != null ? Number(m[5]) : now.getMinutes(),
  };
}

function dayIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function isDayOutOfRange(native: HTMLInputElement, year: number, month: number, day: number): boolean {
  const iso = dayIso(year, month, day);
  const min = (native.min || '').slice(0, 10);
  const max = (native.max || '').slice(0, 10);
  if (min && iso < min) return true;
  if (max && iso > max) return true;
  return false;
}

function openDateTimePicker(anchor: HTMLElement, native: HTMLInputElement, withTime: boolean): void {
  closeDateTimePicker();
  const dark = document.documentElement.classList.contains('dark');
  const state = parseNativeDateTime(native.value);
  let viewYear = state.year;
  let viewMonth = state.month;

  const popup = document.createElement('div');
  popup.className = `de-datetime-popup${dark ? ' de-datetime-popup-dark' : ''}`;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', withTime ? 'Datum und Uhrzeit wählen' : 'Datum wählen');

  const header = document.createElement('div');
  header.className = 'de-datetime-popup-header';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'de-datetime-nav';
  prev.setAttribute('aria-label', 'Vorheriger Monat');
  prev.textContent = '‹';
  const title = document.createElement('div');
  title.className = 'de-datetime-month';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'de-datetime-nav';
  next.setAttribute('aria-label', 'Nächster Monat');
  next.textContent = '›';
  header.append(prev, title, next);

  const weekRow = document.createElement('div');
  weekRow.className = 'de-datetime-weekdays';
  for (const wd of WEEKDAYS_DE) {
    const el = document.createElement('span');
    el.textContent = wd;
    weekRow.appendChild(el);
  }

  const grid = document.createElement('div');
  grid.className = 'de-datetime-grid';
  popup.append(header, weekRow, grid);

  let hourSel: HTMLSelectElement | null = null;
  let minSel: HTMLSelectElement | null = null;
  if (withTime) {
    const timeRow = document.createElement('div');
    timeRow.className = 'de-datetime-time';
    const timeLabel = document.createElement('span');
    timeLabel.textContent = 'Uhrzeit';
    hourSel = document.createElement('select');
    hourSel.className = 'de-datetime-select';
    hourSel.setAttribute('aria-label', 'Stunde (0–23)');
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = pad2(h);
      hourSel.appendChild(opt);
    }
    hourSel.value = String(state.hour);
    const colon = document.createElement('span');
    colon.className = 'de-datetime-colon';
    colon.textContent = ':';
    minSel = document.createElement('select');
    minSel.className = 'de-datetime-select';
    minSel.setAttribute('aria-label', 'Minute');
    for (let m = 0; m < 60; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = pad2(m);
      minSel.appendChild(opt);
    }
    minSel.value = String(state.minute);
    timeRow.append(timeLabel, hourSel, colon, minSel);
    popup.appendChild(timeRow);
  }

  const commit = () => {
    const datePart = dayIso(state.year, state.month, state.day);
    native.value = withTime
      ? `${datePart}T${pad2(Number(hourSel?.value ?? state.hour))}:${pad2(Number(minSel?.value ?? state.minute))}`
      : datePart;
    native.dispatchEvent(new Event('input', { bubbles: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const renderGrid = () => {
    title.textContent = `${MONTHS_DE[viewMonth]} ${viewYear}`;
    grid.innerHTML = '';
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let i = 0; i < startOffset; i++) {
      grid.appendChild(document.createElement('span'));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(day);
      btn.className = 'de-datetime-day';
      const out = isDayOutOfRange(native, viewYear, viewMonth, day);
      if (out) {
        btn.disabled = true;
        btn.classList.add('is-disabled');
      }
      if (day === state.day && viewMonth === state.month && viewYear === state.year) {
        btn.classList.add('is-selected');
      }
      const today = new Date();
      if (day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()) {
        btn.classList.add('is-today');
      }
      btn.addEventListener('click', () => {
        if (out) return;
        state.year = viewYear;
        state.month = viewMonth;
        state.day = day;
        commit();
        if (withTime) renderGrid();
        else closeDateTimePicker();
      });
      grid.appendChild(btn);
    }
  };

  prev.addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderGrid();
  });
  next.addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderGrid();
  });
  hourSel?.addEventListener('change', commit);
  minSel?.addEventListener('change', commit);
  renderGrid();

  document.body.appendChild(popup);
  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  let top = rect.bottom + 4;
  let left = rect.left;
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  if (left + pw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pw - pad);
  if (top + ph > window.innerHeight - pad) top = Math.max(pad, rect.top - ph - 4);
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;

  const onDoc = (ev: MouseEvent) => {
    const t = ev.target as Node | null;
    if (t && (popup.contains(t) || anchor.contains(t))) return;
    closeDateTimePicker();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeDateTimePicker();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
  }, 0);
  openPopup = popup;
  openPopupCleanup = () => {
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
  };
}

function enhanceOne(native: HTMLInputElement): void {
  if (native.dataset.deDate === '1') return;
  if (native.type !== 'date' && native.type !== 'datetime-local') return;
  native.lang = 'de-DE';
  native.dataset.deDate = '1';

  const wrap = document.createElement('span');
  wrap.className = 'de-date-wrap inline-flex items-center gap-1 min-w-0';
  if (native.classList.contains('w-full') || native.className.includes('w-full')) {
    wrap.classList.add('w-full');
  }
  if (native.classList.contains('mt-1') || native.className.includes('mt-1')) {
    wrap.classList.add('mt-1');
  }

  const display = document.createElement('input');
  display.type = 'text';
  display.autocomplete = 'off';
  display.spellcheck = false;
  display.lang = 'de-DE';
  display.inputMode = 'numeric';
  display.placeholder = native.type === 'datetime-local' ? 'TT.MM.JJJJ HH:mm' : 'TT.MM.JJJJ';
  display.title = native.type === 'datetime-local' ? 'Datum und Uhrzeit (24h), z.B. 19.08.2026 14:30' : 'Datum, z.B. 19.08.2026';
  display.className = native.className
    .replace(/\bmt-1\b/g, '')
    .replace(/\bw-full\b/g, '')
    .trim();
  display.classList.add('flex-1', 'min-w-0');
  if (native.className.includes('w-full') || wrap.classList.contains('w-full')) {
    display.classList.add('w-full');
  }
  display.required = native.required;
  display.disabled = native.disabled;
  display.value = nativeToDisplay(native);

  const pickerBtn = document.createElement('button');
  pickerBtn.type = 'button';
  pickerBtn.tabIndex = -1;
  pickerBtn.className = 'flex-shrink-0 p-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700';
  pickerBtn.title = native.type === 'datetime-local' ? 'Datum und Uhrzeit wählen' : 'Kalender öffnen';
  pickerBtn.setAttribute('aria-label', pickerBtn.title);
  pickerBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;

  native.classList.add('de-date-native');
  native.setAttribute('tabindex', '-1');
  native.setAttribute('aria-hidden', 'true');

  native.parentNode?.insertBefore(wrap, native);
  wrap.appendChild(display);
  wrap.appendChild(pickerBtn);
  wrap.appendChild(native);

  const syncDisplay = () => {
    display.value = nativeToDisplay(native);
  };

  if (valueDesc?.get && valueDesc?.set) {
    Object.defineProperty(native, 'value', {
      configurable: true,
      enumerable: true,
      get() {
        return valueDesc.get!.call(this);
      },
      set(v: string) {
        valueDesc.set!.call(this, v);
        syncDisplay();
      },
    });
  }

  native.addEventListener('change', syncDisplay);
  native.addEventListener('input', syncDisplay);

  display.addEventListener('blur', () => {
    const parsed = displayToNative(native, display.value);
    if (parsed === null) {
      display.classList.add('border-red-400');
      syncDisplay();
      display.classList.remove('border-red-400');
      return;
    }
    native.value = parsed;
    native.dispatchEvent(new Event('change', { bubbles: true }));
  });

  display.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      display.blur();
    }
  });

  pickerBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (openPopup) {
      closeDateTimePicker();
      return;
    }
    openDateTimePicker(wrap, native, native.type === 'datetime-local');
  });
}

export function enhanceGermanDateFields(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement>('input[type="date"], input[type="datetime-local"]').forEach(enhanceOne);
}
