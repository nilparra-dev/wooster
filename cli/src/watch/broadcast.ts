import { isRecord } from "../json.js";
import { readTextBody } from "../net/body.js";
import { fetchAllowedMedia } from "../net/media.js";
import { queryTwitchGql } from "../twitch/query.js";
import type { ChannelRef } from "./chat-images.js";

const STORYBOARD_TIMEOUT_MS = 15_000;
/** A storyboard index lists a handful of sprite sheets; this is generous. */
const MAX_STORYBOARD_BYTES = 256 * 1024;
const AVATAR = /^https:\/\/static-cdn\.jtvnw\.net\/jtv_user_pictures\/([A-Za-z0-9_-]{1,160}\.(?:jpe?g|png|webp|gif))$/;
const CHANNEL_FIELDS = "id login displayName profileImageURL(width: 70)";

export interface BroadcastChannel {
  /** Twitch user ID, which third-party emote services key their sets by. */
  id: string;
  login: string;
  name: string;
  /** Profile image file name, served by the player through `api/avatar/<file>`. */
  avatar: string | null;
}

export interface BroadcastChapter {
  startSeconds: number;
  title: string;
}

/** What Twitch says about a broadcast beyond its media: identity and structure. */
export interface BroadcastInfo {
  channel: BroadcastChannel | null;
  title: string | null;
  category: string | null;
  startedAt: string | null;
  chapters: BroadcastChapter[];
  /** URL of the seek preview index, when Twitch still lists the video. */
  storyboardUrl: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseChannel(value: unknown): BroadcastChannel | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const login = text(value.login);
  if (!id || !login || !/^\d{1,20}$/.test(id)) return null;
  return {
    id,
    login,
    name: text(value.displayName) ?? login,
    // An image outside Twitch's avatar path is dropped: the proxy would refuse it.
    avatar: AVATAR.exec(text(value.profileImageURL) ?? "")?.[1] ?? null,
  };
}

function parseChapters(value: unknown): BroadcastChapter[] {
  const edges = isRecord(value) && Array.isArray(value.edges) ? value.edges : [];
  const chapters: BroadcastChapter[] = [];
  for (const edge of edges.slice(0, 200)) {
    const node = isRecord(edge) ? edge.node : null;
    if (!isRecord(node)) continue;
    const position = node.positionMilliseconds;
    const title = text(node.description);
    if (typeof position !== "number" || !Number.isFinite(position) || position < 0 || !title) continue;
    chapters.push({ startSeconds: position / 1000, title });
  }
  return chapters.sort((a, b) => a.startSeconds - b.startSeconds);
}

/**
 * Ask Twitch who broadcast this and, for a video it still lists, its title,
 * category, chapters and seek previews. A hidden VOD is known only by its
 * channel, so everything about the video itself stays null.
 */
export async function loadBroadcastInfo(
  owner: ChannelRef,
  options: { fetch?: typeof fetch; signal: AbortSignal },
): Promise<BroadcastInfo> {
  const transport = {
    signal: options.signal,
    attempts: 2,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  if (owner.kind === "channel") {
    const data = await queryTwitchGql(
      {
        query: `query($login: String!) { user(login: $login) { ${CHANNEL_FIELDS} } }`,
        variables: { login: owner.login },
      },
      transport,
    );
    return {
      channel: parseChannel(data.user),
      title: null,
      category: null,
      startedAt: null,
      chapters: [],
      storyboardUrl: null,
    };
  }
  const data = await queryTwitchGql(
    {
      query: `query($id: ID!) { video(id: $id) { title createdAt seekPreviewsURL game { displayName } owner { ${CHANNEL_FIELDS} } moments(momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { positionMilliseconds description } } } } }`,
      variables: { id: owner.videoId },
    },
    transport,
  );
  const video = isRecord(data.video) ? data.video : {};
  return {
    channel: parseChannel(video.owner),
    title: text(video.title),
    category: isRecord(video.game) ? text(video.game.displayName) : null,
    startedAt: text(video.createdAt),
    chapters: parseChapters(video.moments),
    storyboardUrl: text(video.seekPreviewsURL),
  };
}

/**
 * Seek previews: sprite sheets of `cols` by `rows` tiles, one tile every
 * `interval` seconds, `count` tiles in all across `images`.
 */
export interface Storyboard {
  images: string[];
  interval: number;
  count: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
}

function within(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/** Pick the sharpest usable sheet set from a storyboard index. */
export function parseStoryboard(value: unknown, base: string): Storyboard | null {
  if (!Array.isArray(value)) return null;
  let best: Storyboard | null = null;
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.images)) continue;
    const interval = typeof item.interval === "number" && item.interval > 0 ? item.interval : null;
    const count = within(item.count, 1, 20_000);
    const cols = within(item.cols, 1, 100);
    const rows = within(item.rows, 1, 100);
    const width = within(item.width, 1, 1000);
    const height = within(item.height, 1, 1000);
    const names = item.images.filter((name): name is string => typeof name === "string");
    if (!interval || !count || !cols || !rows || !width || !height) continue;
    if (names.length === 0 || names.length > 400 || names.length !== item.images.length) continue;
    // The sheets must hold every tile the index promises.
    if (names.length * cols * rows < count) continue;
    if (best && best.width >= width) continue;
    best = {
      images: names.map((name) => new URL(name, base).href),
      interval,
      count,
      cols,
      rows,
      width,
      height,
    };
  }
  return best;
}

/**
 * Fetch and parse a storyboard index from Twitch's VOD servers. Returns null
 * when the video has none. Image URLs are absolute; the caller must still
 * check each against the media allowlist before proxying it.
 */
export async function loadStoryboard(
  url: string,
  options: { fetch?: typeof fetch; signal: AbortSignal },
): Promise<Storyboard | null> {
  const response = await fetchAllowedMedia(url, {
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(STORYBOARD_TIMEOUT_MS)]),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 403 || response.status === 404) return null;
    throw new Error(`Seek previews unavailable (HTTP ${response.status}).`);
  }
  return parseStoryboard(
    JSON.parse(await readTextBody(response, MAX_STORYBOARD_BYTES)),
    response.url || url,
  );
}
