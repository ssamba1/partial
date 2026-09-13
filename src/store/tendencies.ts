import { addToBook, EMPTY_BOOK, sanitizeBook, type Tendencies, type TendencyBook } from '../core/intonation';
import { dayKey } from '../core/practice';
import { getSettings, updateSettings } from './settings';

/**
 * Intonation tendencies live in their own storage key, apart from settings, so
 * saving them every few seconds does not notify every settings subscriber.
 */
const KEY = 'partial.tendencies.v2';

function load(): TendencyBook {
  let book: TendencyBook = EMPTY_BOOK;
  let stored = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      book = sanitizeBook(JSON.parse(raw));
      stored = true;
    }
  } catch {
    // Blocked or corrupt storage: start empty.
  }
  // Older versions kept one set of sums in settings, mixing tunings. Keep them, marked as older readings.
  const old = getSettings().tendencies;
  if (!stored && old && Object.keys(old).length) {
    book = sanitizeBook({ tunings: {}, legacy: old });
    save(book);
    updateSettings({ tendencies: {} });
  }
  return book;
}

function save(book: TendencyBook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // Quota or blocked storage: keep in memory only.
  }
}

let current: TendencyBook | null = null;

export function getTendencyBook(): TendencyBook {
  current ??= load();
  return current;
}

/** Adds today's readings for one tuning key. */
export function saveTendencies(key: string, add: Tendencies, now = new Date()): void {
  if (!Object.keys(add).length) return;
  current = addToBook(getTendencyBook(), key, dayKey(now), add);
  save(current);
}

export function clearTendencies(): void {
  current = { tunings: {}, legacy: {} };
  save(current);
}
