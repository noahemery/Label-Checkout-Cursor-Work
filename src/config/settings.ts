export interface AppSettings {
  /** Regex (full-match recommended) that identifies RFID badge payloads. */
  badgePattern: string;
  /** Max ms between keystrokes to still count as a scanner burst. */
  burstGapMs: number;
  /** Pause after the last keystroke before a scanner burst auto-commits. */
  commitPauseMs: number;
  /** How long the green VERIFIED verdict stays up before auto-advancing. */
  autoAdvanceMs: number;
  /** Idle time before auto sign-out while signed in (ms). Admin-adjustable. */
  sessionTimeoutMs: number;
  soundEnabled: boolean;
}

/** Slider range for session timeout (minutes). */
export const SESSION_TIMEOUT_MIN_MINUTES = 1;
export const SESSION_TIMEOUT_MAX_MINUTES = 60;
export const SESSION_TIMEOUT_DEFAULT_MINUTES = 20;

export function sessionTimeoutToMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

export function minutesToSessionTimeout(minutes: number): number {
  const clamped = Math.min(
    SESSION_TIMEOUT_MAX_MINUTES,
    Math.max(SESSION_TIMEOUT_MIN_MINUTES, minutes),
  );
  return clamped * 60_000;
}

export const DEFAULT_SETTINGS: AppSettings = {
  /** Alltech prox badges are often 5 digits (e.g. 13925). */
  badgePattern: '^\\d{5,14}$',
  burstGapMs: 40,
  commitPauseMs: 250,
  autoAdvanceMs: 2500,
  sessionTimeoutMs: minutesToSessionTimeout(SESSION_TIMEOUT_DEFAULT_MINUTES),
  soundEnabled: true,
};

export const SETTINGS_STORAGE_KEY = 'lvs-settings';

export function parseSettings(raw: string | null | undefined): AppSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(raw) as Partial<AppSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    // Upgrade legacy default that rejected 5-digit prox badges.
    if (merged.badgePattern === '^\\d{6,10}$') {
      merged.badgePattern = DEFAULT_SETTINGS.badgePattern;
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function loadSettings(): AppSettings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
