const SESSION_KEY = 'lvs-shift-session';

export interface ShiftSession {
  id: string;
  date: string;
  shift: string;
}

function detectShift(d: Date): string {
  const h = d.getHours();
  if (h >= 6 && h < 14) return '1st';
  if (h >= 14 && h < 22) return '2nd';
  return '3rd';
}

/** Stable session id for the current calendar day — used in exports. */
export function getShiftSession(): ShiftSession {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShiftSession;
      if (parsed.date === today && parsed.id) return parsed;
    }
  } catch {
    /* ignore corrupt storage */
  }
  const id = `${today.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const session: ShiftSession = { id, date: today, shift: detectShift(new Date()) };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function todayExportDate(): string {
  return new Date().toISOString().slice(0, 10);
}
