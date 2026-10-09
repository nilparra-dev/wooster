import { useEffect, useMemo, useState } from "react";
import { array, record, string } from "@chat-protocol";

export interface BadgeImage {
  title: string;
  url: string;
}

export interface ChatImages {
  /** Local URL of a Twitch emote image. */
  emote: (id: string) => string;
  /** Badge images keyed by `setId/version`; empty until they load. */
  badges: ReadonlyMap<string, BadgeImage>;
  /** BetterTTV, FrankerFaceZ and 7TV emote images keyed by the word that stands for them. */
  words: ReadonlyMap<string, string>;
}

function parseBadges(value: unknown): Map<string, BadgeImage> {
  const badges = new Map<string, BadgeImage>();
  for (const item of array(record(value).badges)) {
    const badge = record(item);
    badges.set(`${string(badge.setId)}/${string(badge.version)}`, {
      title: string(badge.title),
      url: string(badge.url),
    });
  }
  return badges;
}

function parseWords(value: unknown): Map<string, string> {
  const words = new Map<string, string>();
  for (const item of array(record(value).emotes)) {
    const emote = record(item);
    words.set(string(emote.name), string(emote.url));
  }
  return words;
}

const NONE: ReadonlyMap<string, never> = new Map<string, never>();

/**
 * Emote and badge images for the chat. The page's content security policy
 * only allows images from its own origin, so they exist only when the watch
 * server is there to proxy them: `api` is its base URL, or null in the static
 * page. `channelRevision` is the session whose channel the badges and the
 * third-party emotes belong to, or null when the chat on screen is not that
 * session's.
 *
 * Images are decoration. When they cannot load, the chat falls back to emote
 * names and badge tooltips, so a failure here is not reported.
 */
export function useChatImages(
  api: string | null,
  channelRevision: number | null,
): ChatImages | null {
  const [loaded, setLoaded] = useState<{
    revision: number;
    badges?: Map<string, BadgeImage>;
    words?: Map<string, string>;
  } | null>(null);

  useEffect(() => {
    if (api === null || channelRevision === null) return;
    const controller = new AbortController();
    const load = <T>(route: string, parse: (value: unknown) => T, store: (parsed: T) => object) =>
      void fetch(`${api}${route}?revision=${channelRevision}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) return;
          const parsed = parse(await response.json());
          if (controller.signal.aborted) return;
          setLoaded((previous) => ({
            ...(previous?.revision === channelRevision ? previous : {}),
            revision: channelRevision,
            ...store(parsed),
          }));
        })
        .catch(() => undefined);
    load("badges", parseBadges, (badges) => ({ badges }));
    load("emotes", parseWords, (words) => ({ words }));
    return () => controller.abort();
  }, [api, channelRevision]);

  return useMemo(() => {
    if (api === null) return null;
    const current = loaded && loaded.revision === channelRevision ? loaded : null;
    return {
      emote: (id) => `${api}emote/${encodeURIComponent(id)}`,
      badges: current?.badges ?? NONE,
      words: current?.words ?? NONE,
    };
  }, [api, channelRevision, loaded]);
}
