/**
 * Browser storage for viewer conveniences. Storage can be blocked or full, and
 * anything read back may have been written by an older build or edited by
 * hand, so every read is validated and every failure falls back to a default:
 * playback never depends on it.
 */

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Playback works without browser storage. */
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface Preferences {
  volume: number;
  muted: boolean;
  speed: number;
  chatVisible: boolean;
  /** Width of the chat column in pixels, or null for the layout's default. */
  chatWidth: number | null;
}

const PREFERENCES_KEY = "replay:preferences";
const DEFAULTS: Preferences = {
  volume: 1,
  muted: false,
  speed: 1,
  chatVisible: true,
  chatWidth: null,
};
export const CHAT_WIDTH = { min: 260, max: 640 } as const;

export function loadPreferences(): Preferences {
  const stored = read(PREFERENCES_KEY);
  if (!isRecord(stored)) return DEFAULTS;
  const { volume, muted, speed, chatVisible, chatWidth } = stored;
  return {
    volume: typeof volume === "number" && volume >= 0 && volume <= 1 ? volume : DEFAULTS.volume,
    muted: typeof muted === "boolean" ? muted : DEFAULTS.muted,
    speed: PLAYBACK_RATES.some((rate) => rate === speed) ? Number(speed) : DEFAULTS.speed,
    chatVisible: typeof chatVisible === "boolean" ? chatVisible : DEFAULTS.chatVisible,
    chatWidth:
      typeof chatWidth === "number" && chatWidth >= CHAT_WIDTH.min && chatWidth <= CHAT_WIDTH.max
        ? chatWidth
        : DEFAULTS.chatWidth,
  };
}

export function savePreferences(change: Partial<Preferences>): void {
  write(PREFERENCES_KEY, { ...loadPreferences(), ...change });
}

/** Widest chat offset the player accepts, in seconds either way. */
export const MAX_CHAT_OFFSET = 86_400;

/** Chat sync offset saved for one video, keyed like its playback position. */
export function loadChatOffset(videoKey: string): number {
  const stored = videoKey ? read(`${videoKey}:offset`) : null;
  return typeof stored === "number" && Math.abs(stored) <= MAX_CHAT_OFFSET ? stored : 0;
}

export function saveChatOffset(videoKey: string, offset: number): void {
  if (videoKey) write(`${videoKey}:offset`, offset);
}

export interface RecentBroadcast {
  /** Target to hand back to the watch bridge. */
  input: string;
  title: string;
  time: number;
  duration: number;
}

const RECENT_KEY = "replay:recent";
const MAX_RECENT = 6;

export function loadRecent(): RecentBroadcast[] {
  const stored = read(RECENT_KEY);
  if (!Array.isArray(stored)) return [];
  const recent: RecentBroadcast[] = [];
  for (const item of stored.slice(0, MAX_RECENT)) {
    if (!isRecord(item)) continue;
    const { input, title, time, duration } = item;
    if (
      typeof input === "string" &&
      input.length > 0 &&
      input.length <= 2000 &&
      typeof title === "string" &&
      typeof time === "number" &&
      time >= 0 &&
      typeof duration === "number" &&
      duration >= 0
    )
      recent.push({ input, title: title.slice(0, 300), time, duration });
  }
  return recent;
}

/**
 * Move a broadcast to the front of the recent list, merging `change` into its
 * entry. A change without a title only updates a broadcast already listed.
 */
export function rememberRecent(
  input: string,
  change: Partial<Omit<RecentBroadcast, "input">>,
): void {
  const recent = loadRecent();
  const known = recent.find((item) => item.input === input);
  if (!known && change.title === undefined) return;
  write(
    RECENT_KEY,
    [
      { input, title: "", time: 0, duration: 0, ...known, ...change },
      ...recent.filter((item) => item !== known),
    ].slice(0, MAX_RECENT),
  );
}

export function clearRecent(): void {
  write(RECENT_KEY, []);
}
