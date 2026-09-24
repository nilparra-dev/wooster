import { setTimeout as delay } from "node:timers/promises";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Request attempts for a tracker page before the failure is reported. */
const DEFAULT_ATTEMPTS = 4;
/** Backoff base between attempts when the server does not name its own. */
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 15_000;

const TWITRACKER_ROOT = "https://twitracker.com";
/** Rows collected when the caller does not say how many it wants. */
const DEFAULT_TWITRACKER_LIMIT = 15;

/** A tracker did not answer usable content: HTTP rejection or transport failure. */
export class TrackerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

export interface TrackerOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Attempts for transient failures. Defaults to {@link DEFAULT_ATTEMPTS}. */
  attempts?: number;
  /** Backoff base in milliseconds. Defaults to {@link DEFAULT_RETRY_DELAY_MS}. */
  retryDelayMs?: number;
}

export interface TwitTrackerOptions extends TrackerOptions {
  /**
   * Rows to collect from the JSON stream table, which serves 15 rows per page.
   * Defaults to {@link DEFAULT_TWITRACKER_LIMIT}; the HTML page fallback always
   * returns the single page it renders.
   */
  limit?: number;
}

export interface TrackerStream {
  source: "twitracker" | "streamervitals";
  channel: string;
  /** Twitch stream ID when the source exposes it. */
  streamId: string | null;
  /** Internal page ID used by the source when it has one. */
  internalId: string | null;
  startedAt: number;
  title: string | null;
  category: string | null;
  durationSeconds: number | null;
  averageViewers: number | null;
  peakViewers: number | null;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function cellTexts(row: string): string[] {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
    decodeEntities(stripTags(match[1] ?? "")).replace(/\s+/g, " ").trim(),
  );
}

/** Parse strings such as "2h 15m", "50m" or "1h 2m 3s" into seconds. */
export function parseDurationText(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (!text || text === "-" || text === "—") return null;
  const match = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/.exec(text);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** Parse display counts such as "1,131", "3.1K" or "2.4M" into numbers. */
export function parseCountText(value: string): number | null {
  const text = value.trim().replaceAll(",", "");
  if (!text || text === "-" || text === "—") return null;
  const match = /^(\d+(?:\.\d+)?)\s*([KkMm])?$/.exec(text);
  if (!match?.[1]) return null;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  return Math.round(base);
}

/**
 * Rate limits and server errors are transient: the trackers answer 429/503
 * under load and TwiTracker sends `Retry-After` while it throttles.
 */
function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Server-requested wait when given, exponential backoff otherwise. */
function retryDelayMs(response: Response | null, attempt: number, baseMs: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(requested)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, requested));
  }
  return Math.min(MAX_RETRY_DELAY_MS, baseMs * 2 ** attempt);
}

/**
 * Fetch a tracker page with bounded retries. Transient failures are retried,
 * final ones raise TrackerError: a caller that receives no data must be able to
 * tell "this tracker has nothing for the channel" from "this tracker did not
 * answer", because only the first is a fact about the channel.
 */
async function fetchText(url: string, options: TrackerOptions): Promise<string> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let failure = { code: "NETWORK_ERROR", detail: "Tracker request failed" };
  let attemptsMade = 0;
  let response: Response | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    options.signal?.throwIfAborted();
    attemptsMade = attempt + 1;
    response = null;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 12_000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    try {
      const candidate = await (options.fetch ?? fetch)(url, {
        headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
        redirect: "follow",
        signal,
      });
      if (candidate.ok) return await candidate.text();
      const status = candidate.status;
      await candidate.body?.cancel();
      failure = { code: "HTTP_ERROR", detail: `Tracker returned HTTP ${status}` };
      if (!isTransient(status)) break;
      response = candidate;
    } catch (error) {
      options.signal?.throwIfAborted();
      const detail = error instanceof Error ? error.message : String(error);
      failure = { code: "NETWORK_ERROR", detail: `Tracker request failed: ${detail}` };
    }
    if (attempt + 1 < attempts) {
      await delay(retryDelayMs(response, attempt, baseMs), undefined, { signal: options.signal });
    }
  }
  // Reporting the retries taken separates a server that keeps throttling from
  // one that rejected the request outright.
  const retries = attemptsMade > 1 ? `, retried ${attemptsMade - 1} time${attemptsMade === 2 ? "" : "s"}` : "";
  throw new TrackerError(failure.code, `${failure.detail} (${new URL(url).hostname}${retries})`);
}

async function fetchJson(url: string, options: TrackerOptions): Promise<unknown | null> {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoToEpoch(value: string): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Tracker counts are whole numbers in their tables, so keep them whole here. */
function wholeNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Read the exact start second from a twitracker.com stream page. The page
 * embeds `datetime="2026-09-09T20:41:21.000Z"` in its header.
 */
export function parseTwitTrackerStreamTime(html: string): number | null {
  const match = html.match(/<time[^>]*\sdatetime="([^"]+)"/i);
  if (!match?.[1]) return null;
  return isoToEpoch(match[1]);
}

/**
 * Parse the recent-streams table of a twitracker.com channel page.
 * Columns: [0] started, [1] duration, [2] title, [3] category, [4] language,
 * [5] peak viewers, [6] average viewers, [7] watch hours, [8] followers.
 */
export function parseTwitTrackerStreams(html: string, channel: string): TrackerStream[] {
  const streams: TrackerStream[] = [];
  for (const row of html.split(/<tr[\s>]/i).slice(1)) {
    const link = row.match(/href="\/streamers\/([^/"]+)\/streams\/(\d+)"/i);
    const time = row.match(/<time[^>]*\sdatetime="([^"]+)"/i);
    if (!link?.[2] || !time?.[1]) continue;
    const startedAt = isoToEpoch(time[1]);
    if (startedAt === null) continue;
    const cells = cellTexts(row);
    streams.push({
      source: "twitracker",
      channel,
      streamId: link[2],
      internalId: null,
      startedAt,
      title: cells[2] || null,
      category: cells[3] || null,
      durationSeconds: parseDurationText(cells[1] ?? ""),
      averageViewers: parseCountText(cells[6] ?? ""),
      peakViewers: parseCountText(cells[5] ?? ""),
    });
  }
  return streams;
}

/**
 * Parse one page of TwiTracker's JSON stream table
 * (`/api/streamers/<channel>/streams?page=N`), which carries the same rows as
 * the channel page with the exact start second in `startedAt`. Rows without a
 * usable stream ID or start second are dropped: a row the resolver cannot turn
 * into a target only moves the failure downstream.
 *
 * @throws TrackerError when the answer carries no stream list, so the caller
 * can fall back to the HTML page instead of reporting an empty channel.
 */
export function parseTwitTrackerApiStreams(payload: unknown, channel: string): TrackerStream[] {
  let rows: unknown[] | null = null;
  if (isRecord(payload)) {
    if (Array.isArray(payload.rows)) rows = payload.rows;
    else if (Array.isArray(payload.streams)) rows = payload.streams;
  }
  if (rows === null) {
    throw new TrackerError("INVALID_DATA", "TwiTracker API answered without a stream list");
  }

  const streams: TrackerStream[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const streamId = typeof row.id === "string" ? row.id : null;
    if (streamId === null || !/^\d+$/.test(streamId)) continue;
    const startedAt = typeof row.startedAt === "string" ? isoToEpoch(row.startedAt) : null;
    if (startedAt === null) continue;
    streams.push({
      source: "twitracker",
      channel,
      streamId,
      internalId: null,
      startedAt,
      title: textOrNull(row.title),
      category: textOrNull(row.gameName),
      durationSeconds: wholeNumberOrNull(row.durationSec),
      averageViewers: wholeNumberOrNull(row.avgViewers),
      peakViewers: wholeNumberOrNull(row.peakViewers),
    });
  }
  if (streams.length === 0 && rows.length > 0) {
    throw new TrackerError("INVALID_DATA", "TwiTracker API rows carried no usable stream ID");
  }
  return streams;
}

/**
 * Parse the stream history table of a streamervitals.com channel page.
 * Columns: [0] category, [1] duration, [2] average viewers, [3] peak viewers,
 * [4] watch hours. The page does not expose Twitch stream IDs.
 */
export function parseStreamerVitalsStreams(html: string, channel: string): TrackerStream[] {
  const streams: TrackerStream[] = [];
  const linkPattern = new RegExp(`href="/${escapeRegExp(channel)}/stream/(\\d+)"`, "i");
  for (const row of html.split(/<tr[\s>]/i).slice(1)) {
    if (!row.includes("sv-row-link")) continue;
    const link = row.match(linkPattern);
    const time = row.match(/dateTime="([^"]+)"/i);
    if (!link?.[1] || !time?.[1]) continue;
    const startedAt = isoToEpoch(time[1]);
    if (startedAt === null) continue;
    const title = row.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    const cells = cellTexts(row);
    streams.push({
      source: "streamervitals",
      channel,
      streamId: null,
      internalId: link[1],
      startedAt,
      title: title?.[1] ? decodeEntities(stripTags(title[1])).replace(/\s+/g, " ").trim() : null,
      category: cells[0] || null,
      durationSeconds: parseDurationText(cells[1] ?? ""),
      averageViewers: parseCountText(cells[2] ?? ""),
      peakViewers: parseCountText(cells[3] ?? ""),
    });
  }
  return streams;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ask TwiTracker's JSON API first and fall back to its HTML page. The two sit
 * behind different limits: while the pages answer `503 Server busy` the API
 * keeps answering from cache, so a caller that only knows the page loses the
 * channel exactly when the tracker is under load. The first endpoint that
 * answers wins, empty answers included; when neither answers, both reasons are
 * reported so the failure names what was actually tried.
 */
async function twitTrackerEndpoints<T>(api: () => Promise<T>, page: () => Promise<T>): Promise<T> {
  const failures: string[] = [];
  try {
    return await api();
  } catch (error) {
    if (!(error instanceof TrackerError)) throw error;
    failures.push(`API: ${error.message}`);
  }
  try {
    return await page();
  } catch (error) {
    if (!(error instanceof TrackerError)) throw error;
    // The chain stopped here, so this failure carries the reported code.
    throw new TrackerError(error.code, [...failures, `page: ${error.message}`].join(" | "));
  }
}

/**
 * Recent streams of a channel from TwiTracker's JSON stream table, which pages
 * 15 rows at a time. The walk stops at the requested row count, at an empty
 * page, and at a page that repeats rows already collected, which bounds it when
 * the server does not honour `page`.
 */
async function fetchTwitTrackerApiStreams(
  channel: string,
  limit: number,
  options: TrackerOptions,
): Promise<TrackerStream[]> {
  const login = channel.toLowerCase();
  const streams: TrackerStream[] = [];
  const seen = new Set<string>();

  for (let page = 1; ; page += 1) {
    let rows: TrackerStream[];
    try {
      const payload = await fetchJson(
        `${TWITRACKER_ROOT}/api/streamers/${encodeURIComponent(login)}/streams?page=${page}`,
        options,
      );
      rows = parseTwitTrackerApiStreams(payload, login);
    } catch (error) {
      if (!(error instanceof TrackerError)) throw error;
      // With no row yet the endpoint is unusable, so the caller falls back to
      // the HTML page; after the first page a failure only truncates the list,
      // because rows already collected are worth more than a failed command.
      if (streams.length === 0) throw error;
      break;
    }
    let added = 0;
    for (const row of rows) {
      const streamId = row.streamId;
      if (streamId === null || seen.has(streamId)) continue;
      seen.add(streamId);
      streams.push(row);
      added += 1;
    }
    if (added === 0 || streams.length >= limit) break;
  }
  return streams.slice(0, limit);
}

async function fetchTwitTrackerPageStreams(channel: string, options: TrackerOptions): Promise<TrackerStream[]> {
  const login = channel.toLowerCase();
  const html = await fetchText(`${TWITRACKER_ROOT}/streamers/${encodeURIComponent(login)}`, options);
  return parseTwitTrackerStreams(html, login);
}

export async function fetchTwitTrackerStreams(
  channel: string,
  options: TwitTrackerOptions = {},
): Promise<TrackerStream[]> {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_TWITRACKER_LIMIT));
  return twitTrackerEndpoints(
    () => fetchTwitTrackerApiStreams(channel, limit, options),
    () => fetchTwitTrackerPageStreams(channel, options),
  );
}

/**
 * Exact start second of one stream from the JSON stream detail, which answers
 * any stream ID in a single request, including IDs the list window does not
 * cover.
 */
async function fetchTwitTrackerApiStreamTime(
  channel: string,
  streamId: string,
  options: TrackerOptions,
): Promise<number> {
  const login = channel.toLowerCase();
  const payload = await fetchJson(`${TWITRACKER_ROOT}/api/streams/${encodeURIComponent(streamId)}`, options);
  if (payload === null) {
    throw new TrackerError("INVALID_DATA", "TwiTracker API answered with a body that is not JSON");
  }
  const stream = isRecord(payload) && isRecord(payload.stream) ? payload.stream : null;
  const startedAt = stream !== null && typeof stream.startedAt === "string" ? isoToEpoch(stream.startedAt) : null;
  // The lookup goes by stream ID alone, so the answer counts only when it
  // describes this channel: another channel's start second would build a
  // target that cannot exist.
  if (
    stream === null ||
    typeof stream.id !== "string" ||
    stream.id !== streamId ||
    typeof stream.login !== "string" ||
    stream.login.toLowerCase() !== login ||
    startedAt === null
  ) {
    throw new TrackerError("INVALID_DATA", `TwiTracker API did not describe ${login}/${streamId}`);
  }
  return startedAt;
}

async function fetchTwitTrackerPageStreamTime(
  channel: string,
  streamId: string,
  options: TrackerOptions,
): Promise<number | null> {
  const login = channel.toLowerCase();
  const html = await fetchText(
    `${TWITRACKER_ROOT}/streamers/${encodeURIComponent(login)}/streams/${encodeURIComponent(streamId)}`,
    options,
  );
  return parseTwitTrackerStreamTime(html);
}

export async function fetchTwitTrackerStreamTime(
  channel: string,
  streamId: string,
  options: TrackerOptions = {},
): Promise<number | null> {
  return twitTrackerEndpoints(
    () => fetchTwitTrackerApiStreamTime(channel, streamId, options),
    () => fetchTwitTrackerPageStreamTime(channel, streamId, options),
  );
}

export async function fetchStreamerVitalsStreams(
  channel: string,
  options: TrackerOptions = {},
): Promise<TrackerStream[]> {
  const html = await fetchText(
    `https://streamervitals.com/${encodeURIComponent(channel.toLowerCase())}/streams`,
    options,
  );
  return parseStreamerVitalsStreams(html, channel.toLowerCase());
}

export interface SullyGnomeMatch {
  startedAt: number;
  title: string | null;
}

/**
 * Resolve a stream start time through SullyGnome. Its API is sometimes behind a
 * Cloudflare challenge from datacenter networks, so every transport failure is
 * a null result and callers fall back to other sources.
 */
export async function fetchSullyGnomeStreamTime(
  channel: string,
  streamId: string,
  options: TrackerOptions = {},
): Promise<number | null> {
  try {
    return await searchSullyGnomeStreamTime(channel, streamId, options);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof TrackerError) return null;
    throw error;
  }
}

async function searchSullyGnomeStreamTime(
  channel: string,
  streamId: string,
  options: TrackerOptions,
): Promise<number | null> {
  const search = await fetchJson(
    `https://sullygnome.com/api/standardsearch/${encodeURIComponent(channel.toLowerCase())}`,
    options,
  );
  if (!Array.isArray(search)) return null;
  const channelItem = search.find(
    (item) =>
      isRecord(item) &&
      item.itemtype === 1 &&
      typeof item.siteurl === "string" &&
      item.siteurl.toLowerCase() === channel.toLowerCase(),
  );
  if (!isRecord(channelItem) || typeof channelItem.value !== "number") return null;

  let start = 0;
  let page = 1;
  while (page <= 50) {
    const payload = await fetchJson(
      `https://sullygnome.com/api/tables/channeltables/streams/365/${channelItem.value}/%20/${page}/1/desc/${start}/100`,
      options,
    );
    if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
    const stream = payload.data.find((item) => isRecord(item) && String(item.streamId) === streamId);
    if (isRecord(stream)) {
      const startedAt = typeof stream.startDateTime === "string" ? isoToEpoch(stream.startDateTime) : null;
      return startedAt;
    }
    const total = typeof payload.recordsFiltered === "number" ? payload.recordsFiltered : 0;
    start += 100;
    page += 1;
    if (start >= total) break;
  }
  return null;
}
