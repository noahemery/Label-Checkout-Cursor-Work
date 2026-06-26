export interface AppSettings {
  /** Regex (full-match recommended) that identifies RFID badge payloads. */
  badgePattern: string;
  /** Max ms between keystrokes to still count as a scanner burst. */
  burstGapMs: number;
  /** Pause after the last keystroke before a scanner burst auto-commits. */
  commitPauseMs: number;
  /** How long the green VERIFIED verdict stays up before auto-advancing. */
  autoAdvanceMs: number;
  soundEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  /** Alltech prox badges are often 5 digits (e.g. 13925). */
  badgePattern: '^\\d{5,14}$',
  burstGapMs: 40,
  commitPauseMs: 250,
  autoAdvanceMs: 2500,
  soundEnabled: true,
};

const STORAGE_KEY = 'lvs-settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<AppSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    // Upgrade legacy default that rejected 5-digit prox badges.
    if (merged.badgePattern === '^\\d{6,10}$') {
      merged.badgePattern = DEFAULT_SETTINGS.badgePattern;
      saveSettings(merged);
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
