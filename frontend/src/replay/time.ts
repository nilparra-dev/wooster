export function clock(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** Compact clock for dense lists: `m:ss`, and `h:mm:ss` only past the hour. */
export function shortClock(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = String(seconds % 60).padStart(2, "0");
  const hours = Math.floor(seconds / 3600);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Parse a Twitch-style start time: `1h2m3s`, any subset of those units, or
 * plain seconds. Returns null for anything else, so an unrelated `t` query
 * parameter is left alone.
 */
export function parseStartTime(value: string): number | null {
  const match = /^(?:(\d{1,3})h)?(?:(\d{1,5})m)?(?:(\d{1,7})s?)?$/.exec(value.trim());
  if (!match || !(match[1] || match[2] || match[3])) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** Inverse of parseStartTime, in the form Twitch writes: `1h2m3s`. */
export function formatStartTime(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}h` : ""}${hours || minutes ? `${minutes}m` : ""}${seconds % 60}s`;
}

/**
 * Split a pasted target into the broadcast and its `?t=` start time. The time
 * is removed from the target so one broadcast keeps one identity for saved
 * positions, whatever moment a link pointed at.
 */
export function splitStartTime(input: string): { input: string; start: number | null } {
  const text = input.trim();
  if (!/^https?:\/\//i.test(text) || !URL.canParse(text)) return { input: text, start: null };
  const url = new URL(text);
  const start = parseStartTime(url.searchParams.get("t") ?? "");
  if (start === null) return { input: text, start: null };
  url.searchParams.delete("t");
  return { input: url.href, start };
}

/** The same target pointing at `seconds`, or null when it is not a URL. */
export function withStartTime(input: string, seconds: number): string | null {
  if (!/^https?:\/\//i.test(input) || !URL.canParse(input)) return null;
  const url = new URL(input);
  url.searchParams.set("t", formatStartTime(seconds));
  return url.href;
}
