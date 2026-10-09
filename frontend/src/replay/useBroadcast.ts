import { useEffect, useState } from "react";
import { array, nullableString, number, record, string } from "@chat-protocol";

/** Seek previews: sprite sheets with one tile every `interval` seconds. */
export interface Storyboard {
  images: string[];
  interval: number;
  count: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
}

export interface Chapter {
  /** Media time at which the chapter begins, in seconds. */
  start: number;
  title: string;
}

/** The chapter playing at `time`, when the broadcast has chapters. */
export function chapterAt(chapters: readonly Chapter[], time: number): Chapter | undefined {
  let current: Chapter | undefined;
  for (const chapter of chapters) if (chapter.start <= time) current = chapter;
  return current;
}

/** What the watch server learned from Twitch about the open broadcast. */
export interface Broadcast {
  channel: { login: string; name: string; avatar: string | null } | null;
  title: string | null;
  category: string | null;
  startedAt: string | null;
  chapters: Chapter[];
  storyboard: Storyboard | null;
}

function parseBroadcast(value: unknown): Broadcast {
  const data = record(value);
  const channel = data.channel === null ? null : record(data.channel);
  const board = data.storyboard === null ? null : record(data.storyboard);
  return {
    channel: channel && {
      login: string(channel.login),
      name: string(channel.name),
      avatar: nullableString(channel.avatar),
    },
    title: nullableString(data.title),
    category: nullableString(data.category),
    startedAt: nullableString(data.startedAt),
    chapters: array(data.chapters).map((item) => {
      const chapter = record(item);
      return { start: number(chapter.start), title: string(chapter.title) };
    }),
    storyboard: board && {
      images: array(board.images).map(string),
      interval: number(board.interval),
      count: number(board.count),
      cols: number(board.cols),
      rows: number(board.rows),
      width: number(board.width),
      height: number(board.height),
    },
  };
}

/**
 * Details of the session's broadcast, asked once per session. Null until they
 * arrive, and they may never: the player shows what the session itself knows
 * in the meantime, so a failure here is not reported.
 */
export function useBroadcast(api: string | null, revision: number | null): Broadcast | null {
  const [loaded, setLoaded] = useState<{ revision: number; broadcast: Broadcast } | null>(null);

  useEffect(() => {
    if (api === null || revision === null) return;
    const controller = new AbortController();
    void fetch(`${api}broadcast?revision=${revision}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const broadcast = parseBroadcast(await response.json());
        if (!controller.signal.aborted) setLoaded({ revision, broadcast });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [api, revision]);

  return loaded && loaded.revision === revision ? loaded.broadcast : null;
}
