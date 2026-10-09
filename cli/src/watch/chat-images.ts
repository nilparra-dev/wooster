import { isRecord } from "../json.js";
import { readBytesBody, readTextBody } from "../net/body.js";
import { queryTwitchGql } from "../twitch/query.js";

/** Twitch's own image host. Third-party emote hosts are listed in THIRD_PARTY. */
const CHAT_IMAGE_ORIGIN = "https://static-cdn.jtvnw.net";
/** Emotes and badges are a few kilobytes; animated emotes stay well under this. */
const MAX_CHAT_IMAGE_BYTES = 2 * 1024 * 1024;
/** Emote lists carry every emote's metadata; a large 7TV set is over a megabyte. */
const MAX_EMOTE_LIST_BYTES = 8 * 1024 * 1024;
const EMOTE_LIST_TIMEOUT_MS = 10_000;
/** Bound on the merged emote list sent to the player. */
const MAX_THIRD_PARTY_EMOTES = 6000;
const CHAT_IMAGE_TIMEOUT_MS = 15_000;
const IMAGE_TYPES = new Set(["image/png", "image/gif", "image/webp", "image/jpeg"]);
const BADGE_FIELDS = "setID version title imageURL(size: DOUBLE)";
const BADGE_IMAGE = /^https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/([0-9a-f-]{36})\/\d$/;

const EMOTE_ID = /^[A-Za-z0-9_]{1,64}$/;
const BADGE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/**
 * Twitch CDN URL of an emote, or null when the ID cannot be one. The ID comes
 * from a chat archive, which is untrusted, so it must not shape the URL beyond
 * a single path segment.
 */
export function emoteImageUrl(id: string): string | null {
  return EMOTE_ID.test(id) ? `${CHAT_IMAGE_ORIGIN}/emoticons/v2/${id}/default/dark/2.0` : null;
}

/** Twitch CDN URL of a badge image, or null when the ID is not a badge UUID. */
export function badgeImageUrl(id: string): string | null {
  return BADGE_ID.test(id) ? `${CHAT_IMAGE_ORIGIN}/badges/v1/${id}/2` : null;
}

const AVATAR_FILE = /^[A-Za-z0-9_-]{1,160}\.(?:jpe?g|png|webp|gif)$/;

/** Twitch CDN URL of a channel's profile image, or null for another file name. */
export function avatarImageUrl(file: string): string | null {
  return AVATAR_FILE.test(file) ? `${CHAT_IMAGE_ORIGIN}/jtv_user_pictures/${file}` : null;
}

/**
 * The emote services most Twitch chats rely on beyond Twitch's own emotes.
 * Each entry fixes the image host and the shape of an ID on it.
 */
const THIRD_PARTY = {
  bttv: {
    id: /^[0-9a-f]{24}$/,
    images: (id: string) => [`https://cdn.betterttv.net/emote/${id}/2x`],
  },
  ffz: {
    id: /^\d{1,12}$/,
    // Small FrankerFaceZ emotes exist only at their base size.
    images: (id: string) => [
      `https://cdn.frankerfacez.com/emote/${id}/2`,
      `https://cdn.frankerfacez.com/emote/${id}/1`,
    ],
  },
  "7tv": {
    id: /^[0-9A-Za-z]{24,26}$/,
    images: (id: string) => [`https://cdn.7tv.app/emote/${id}/2x.webp`],
  },
} as const;

export type EmoteProvider = keyof typeof THIRD_PARTY;

export function isEmoteProvider(value: string): value is EmoteProvider {
  return Object.hasOwn(THIRD_PARTY, value);
}

/**
 * Image URLs to try, in order, for a third-party emote. Empty when the ID
 * does not have the provider's shape.
 */
export function thirdPartyEmoteUrls(provider: EmoteProvider, id: string): string[] {
  const source = THIRD_PARTY[provider];
  return source.id.test(id) ? source.images(id) : [];
}

export interface ChatImage {
  type: string;
  bytes: Buffer;
}

/**
 * Fetch one chat image from a URL built by the helpers above. Returns null
 * when the host has no such image. Redirects are refused: these CDNs serve
 * the paths directly, and following one would leave the host the URL names.
 */
export async function fetchChatImage(
  url: string,
  options: { fetch?: typeof fetch; signal: AbortSignal },
): Promise<ChatImage | null> {
  const response = await (options.fetch ?? fetch)(url, {
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(CHAT_IMAGE_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) return null;
    throw new Error(`Chat image unavailable (HTTP ${response.status}).`);
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!IMAGE_TYPES.has(type)) {
    await response.body?.cancel();
    throw new Error("The image host did not return an image.");
  }
  return { type, bytes: await readBytesBody(response, MAX_CHAT_IMAGE_BYTES) };
}

export interface ChatBadge {
  setId: string;
  version: string;
  title: string;
  /** Badge image UUID, served by the player through `api/badge/<id>`. */
  id: string;
}

/** Which channel's badges to load on top of the global set. */
export type ChannelRef = { kind: "channel"; login: string } | { kind: "video"; videoId: string };

function parseBadges(value: unknown): ChatBadge[] {
  if (!Array.isArray(value)) return [];
  const badges: ChatBadge[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { setID, version, title, imageURL } = item;
    if (typeof setID !== "string" || typeof version !== "string" || typeof imageURL !== "string") continue;
    // Entries that do not point at the badge CDN are dropped, so the player
    // never receives an image the proxy would refuse.
    const id = BADGE_IMAGE.exec(imageURL)?.[1];
    if (!id || !BADGE_ID.test(id)) continue;
    badges.push({ setId: setID, version, title: typeof title === "string" ? title : setID, id });
  }
  return badges;
}

/**
 * Load Twitch's global chat badges and the channel's own (subscriber, bits).
 * A channel badge replaces the global one with the same set and version, which
 * is how Twitch chat resolves them. An unknown channel or a deleted video
 * leaves the global set.
 */
export async function loadChatBadges(
  owner: ChannelRef,
  options: { fetch?: typeof fetch; signal: AbortSignal },
): Promise<ChatBadge[]> {
  const data = await queryTwitchGql(
    owner.kind === "channel"
      ? {
          query: `query($login: String!) { badges { ${BADGE_FIELDS} } user(login: $login) { broadcastBadges { ${BADGE_FIELDS} } } }`,
          variables: { login: owner.login },
        }
      : {
          query: `query($id: ID!) { badges { ${BADGE_FIELDS} } video(id: $id) { owner { broadcastBadges { ${BADGE_FIELDS} } } } }`,
          variables: { id: owner.videoId },
        },
    { signal: options.signal, attempts: 2, ...(options.fetch ? { fetch: options.fetch } : {}) },
  );
  const user = owner.kind === "channel" ? data.user : isRecord(data.video) ? data.video.owner : null;
  const merged = new Map<string, ChatBadge>();
  for (const badge of [
    ...parseBadges(data.badges),
    ...parseBadges(isRecord(user) ? user.broadcastBadges : null),
  ])
    merged.set(`${badge.setId}/${badge.version}`, badge);
  return [...merged.values()];
}

export interface ThirdPartyEmote {
  /** The word that stands for the emote in a message. */
  name: string;
  provider: EmoteProvider;
  id: string;
}

type EmoteEntry = { id: unknown; name: unknown };

function entries(value: unknown, nameKey: "code" | "name"): EmoteEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({ id: item.id, name: item[nameKey] }));
}

/** Emote lists of one provider: its global set, then the channel's. */
const EMOTE_LISTS: Record<
  EmoteProvider,
  { global: string; channel: (userId: string) => string; parse: (data: unknown, global: boolean) => EmoteEntry[] }
> = {
  ffz: {
    global: "https://api.frankerfacez.com/v1/set/global",
    channel: (userId) => `https://api.frankerfacez.com/v1/room/id/${userId}`,
    parse: (data, global) => {
      if (!isRecord(data) || !isRecord(data.sets)) return [];
      // The global answer also carries sets that only some users see.
      const shown = global && Array.isArray(data.default_sets) ? data.default_sets.map(String) : null;
      return Object.entries(data.sets)
        .filter(([key]) => !shown || shown.includes(key))
        .flatMap(([, set]) => (isRecord(set) ? entries(set.emoticons, "name") : []));
    },
  },
  bttv: {
    global: "https://api.betterttv.net/3/cached/emotes/global",
    channel: (userId) => `https://api.betterttv.net/3/cached/users/twitch/${userId}`,
    parse: (data, global) =>
      global
        ? entries(data, "code")
        : isRecord(data)
          ? [...entries(data.channelEmotes, "code"), ...entries(data.sharedEmotes, "code")]
          : [],
  },
  "7tv": {
    global: "https://7tv.io/v3/emote-sets/global",
    channel: (userId) => `https://7tv.io/v3/users/twitch/${userId}`,
    parse: (data, global) => {
      const set = global ? data : isRecord(data) ? data.emote_set : null;
      return isRecord(set) ? entries(set.emotes, "name") : [];
    },
  },
};

async function fetchEmoteList(
  url: string,
  options: { fetch?: typeof fetch; signal: AbortSignal },
): Promise<unknown> {
  const response = await (options.fetch ?? fetch)(url, {
    redirect: "error",
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(EMOTE_LIST_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    // A channel that never signed up with the service has no list.
    if (response.status === 404) return null;
    throw new Error(`Emote list unavailable (HTTP ${response.status}).`);
  }
  return JSON.parse(await readTextBody(response, MAX_EMOTE_LIST_BYTES));
}

/**
 * Load the BetterTTV, FrankerFaceZ and 7TV emotes of a channel, with their
 * global sets. `userId` is the channel's Twitch user ID, or null to load the
 * global sets only.
 *
 * When two emotes share a name the channel's wins over a global one, and
 * between providers 7TV wins over BetterTTV over FrankerFaceZ, the order chat
 * extensions apply. A provider that fails is named in `failed` and the rest
 * are still returned: one service being down should not empty the chat.
 */
export async function loadThirdPartyEmotes(
  userId: string | null,
  options: { fetch?: typeof fetch; signal: AbortSignal },
): Promise<{ emotes: ThirdPartyEmote[]; failed: EmoteProvider[] }> {
  if (userId !== null && !/^\d{1,20}$/.test(userId)) throw new Error("Invalid Twitch user ID.");
  const providers: EmoteProvider[] = ["ffz", "bttv", "7tv"];
  const requests = [true, false].flatMap((global) =>
    providers
      .filter(() => global || userId !== null)
      .map((provider) => ({
        provider,
        global,
        url: global ? EMOTE_LISTS[provider].global : EMOTE_LISTS[provider].channel(userId ?? ""),
      })),
  );
  const answers = await Promise.allSettled(requests.map((request) => fetchEmoteList(request.url, options)));
  options.signal.throwIfAborted();
  const merged = new Map<string, ThirdPartyEmote>();
  const failed = new Set<EmoteProvider>();
  requests.forEach(({ provider, global }, index) => {
    const answer = answers[index];
    if (!answer || answer.status === "rejected") {
      failed.add(provider);
      return;
    }
    for (const entry of EMOTE_LISTS[provider].parse(answer.value, global)) {
      const id = typeof entry.id === "number" ? String(entry.id) : entry.id;
      const { name } = entry;
      if (typeof id !== "string" || thirdPartyEmoteUrls(provider, id).length === 0) continue;
      if (typeof name !== "string" || !/^\S{1,100}$/.test(name)) continue;
      // Re-inserting moves the name to the end, so the cap below drops the
      // oldest global entries first.
      merged.delete(name);
      merged.set(name, { name, provider, id });
    }
  });
  return { emotes: [...merged.values()].slice(-MAX_THIRD_PARTY_EMOTES), failed: [...failed] };
}
