import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { ArchiveInfo, ChatMessage, MessageRun } from "./archive";
import type { WorkerRequest, WorkerResponse } from "./protocol";

type ChatState =
  | { kind: "none" }
  | { kind: "loading"; percent: number }
  | { kind: "ready"; info: ArchiveInfo }
  | { kind: "error"; message: string };

interface ChatReplayOptions {
  /** Local export selected by the user, when any. */
  file: File | null;
  /** Chat served by the watch bridge, when available. */
  remoteUrl?: string;
  remoteSize: number;
  /** Replay clock: media time plus the user offset. */
  time: number;
  /** Replay-clock span of the video, or null while its duration is unknown. */
  span: { start: number; end: number } | null;
}

export interface ChatReplay {
  chat: ChatState;
  ready: boolean;
  query: string;
  setQuery: (value: string) => void;
  searching: boolean;
  displayed: ChatMessage[];
  /** True when the archive may hold matches beyond the ones displayed. */
  moreResults: boolean;
  loadingResults: boolean;
  loadMoreResults: () => void;
  /** False once the viewer scrolls away from the newest message. */
  following: boolean;
  /**
   * True while something holds the chat still without unfollowing it, such as
   * the pointer resting on the log. Following resumes when it is released.
   */
  held: boolean;
  setHeld: (value: boolean) => void;
  setFollowing: (value: boolean) => void;
  log: RefObject<HTMLDivElement>;
  /** Clear the rendered window and any pending search, e.g. after a seek. */
  reset: () => void;
  /** Clear only the rendered window, keeping an active search. */
  clearWindow: () => void;
  /** Prepend the messages before the rendered window, for scrolling back. */
  loadOlder: () => void;
  /** True when scrolling back stopped at the render limit, not at the start. */
  historyFull: boolean;
  /** Message counts per slice of `span`, or null until they are known. */
  activity: number[] | null;
}

/** Most messages kept rendered while the viewer scrolls back. */
const MAX_HISTORY = 1200;
const ACTIVITY_BUCKETS = 240;
const EMPTY: MessageRun = { start: 0, messages: [] };

/**
 * Owns the chat worker, the indexed archive state, the visible window and the
 * debounced search. The media clock decides which messages are visible.
 */
export function useChatReplay(options: ChatReplayOptions): ChatReplay {
  const { file, remoteUrl, remoteSize, time, span } = options;
  const [chat, setChat] = useState<ChatState>({ kind: "none" });
  const [run, setRun] = useState<MessageRun>(EMPTY);
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [nextResult, setNextResult] = useState<number | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [following, setFollowing] = useState(true);
  const [held, setHeld] = useState(false);
  const [activity, setActivity] = useState<number[] | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const worker = useRef<Worker | null>(null);
  const windowId = useRef(0);
  const historyId = useRef(0);
  const searchId = useRef(0);
  const activityId = useRef(0);
  // The run as last set, readable from callbacks without waiting for a render.
  const current = useRef<MessageRun>(EMPTY);
  const historyPending = useRef(false);
  // Search whose reply is wanted, and whether it continues the displayed page.
  const activeSearch = useRef({ id: 0, append: false });
  // Distance from the bottom of the log to keep when older messages are added.
  const anchor = useRef<number | null>(null);
  const ready = chat.kind === "ready";
  const spanStart = span?.start;
  const spanEnd = span?.end;

  // Replacing the run also discards any history request made for the old one.
  const replaceRun = useCallback((next: MessageRun) => {
    current.current = next;
    // An emptied window has to refill, even if the pointer never left the log.
    if (next.messages.length === 0) setHeld(false);
    historyId.current += 1;
    historyPending.current = false;
    setRun(next);
  }, []);

  useEffect(() => {
    replaceRun(EMPTY);
    setResults([]);
    setNextResult(null);
    setActivity(null);
    if (!file && !remoteUrl) {
      setChat({ kind: "none" });
      return;
    }
    let instance: Worker;
    try {
      instance = new Worker(new URL("./chat.worker.ts", import.meta.url), { type: "module" });
    } catch {
      setChat({
        kind: "error",
        message: "Could not start the chat reader. Reload the page and try again.",
      });
      return;
    }
    worker.current = instance;
    setChat({ kind: "loading", percent: 0 });
    instance.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (worker.current !== instance) return;
      switch (data.kind) {
        case "progress":
          setChat({ kind: "loading", percent: data.percent });
          break;
        case "ready":
          setChat({ kind: "ready", info: data.info });
          break;
        case "window":
          if (data.id === windowId.current)
            replaceRun({ start: data.start, messages: data.messages });
          break;
        case "history": {
          if (data.id !== historyId.current) break;
          historyPending.current = false;
          if (data.messages.length === 0) break;
          const element = log.current;
          if (element) anchor.current = element.scrollHeight - element.scrollTop;
          const next = {
            start: data.start,
            messages: [...data.messages, ...current.current.messages],
          };
          current.current = next;
          setRun(next);
          break;
        }
        case "search": {
          if (data.id !== activeSearch.current.id) break;
          const { append } = activeSearch.current;
          setResults((previous) => (append ? [...previous, ...data.messages] : data.messages));
          setNextResult(data.next);
          setSearching(false);
          setLoadingResults(false);
          break;
        }
        case "activity":
          if (data.id === activityId.current) setActivity(data.counts);
          break;
        case "error":
          setChat({ kind: "error", message: data.message });
          setSearching(false);
          setLoadingResults(false);
          break;
      }
    };
    instance.onerror = () =>
      setChat({ kind: "error", message: "The chat reader stopped. Try opening the file again." });
    if (file) instance.postMessage({ kind: "load", file } satisfies WorkerRequest);
    else if (remoteUrl)
      instance.postMessage({
        kind: "loadRemote",
        url: new URL(remoteUrl, location.href).href,
        size: remoteSize,
      } satisfies WorkerRequest);
    return () => {
      worker.current = null;
      instance.terminate();
    };
  }, [file, remoteUrl, remoteSize, replaceRun]);

  useEffect(() => {
    if (!ready || !following || held || query.trim()) return;
    worker.current?.postMessage({
      kind: "window",
      id: ++windowId.current,
      time,
    } satisfies WorkerRequest);
  }, [ready, following, held, query, time]);

  useEffect(() => {
    // A new id makes the worker abandon any scan in flight, even while the
    // input is debounced. Its reply is not a result, so it is never awaited.
    const cancelId = ++searchId.current;
    activeSearch.current = { id: 0, append: false };
    setResults([]);
    setNextResult(null);
    setLoadingResults(false);
    if (!ready) return;
    worker.current?.postMessage({
      kind: "search",
      id: cancelId,
      query: "",
      from: 0,
    } satisfies WorkerRequest);
    setSearching(Boolean(query.trim()));
    if (!query.trim()) return;
    const timer = window.setTimeout(() => {
      const id = ++searchId.current;
      activeSearch.current = { id, append: false };
      worker.current?.postMessage({ kind: "search", id, query, from: 0 } satisfies WorkerRequest);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, ready]);

  useEffect(() => {
    setActivity(null);
    if (!ready || spanStart === undefined || spanEnd === undefined || spanEnd <= spanStart) return;
    worker.current?.postMessage({
      kind: "activity",
      id: ++activityId.current,
      start: spanStart,
      end: spanEnd,
      buckets: ACTIVITY_BUCKETS,
    } satisfies WorkerRequest);
  }, [ready, spanStart, spanEnd]);

  // Older messages grow the log upwards. Restore the distance to the bottom
  // before paint so the message under the viewer's eyes does not move.
  useLayoutEffect(() => {
    const element = log.current;
    if (anchor.current === null || !element) return;
    element.scrollTop = element.scrollHeight - anchor.current;
    anchor.current = null;
  }, [run]);

  useEffect(() => {
    if (following && !held && !query.trim() && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [run, following, held, query]);

  const displayed = query.trim()
    ? results
    : run.messages.filter((message) => message.offsetSeconds <= time);

  const clearWindow = useCallback(() => replaceRun(EMPTY), [replaceRun]);

  const reset = useCallback(() => {
    replaceRun(EMPTY);
    setResults([]);
    setQuery("");
    setFollowing(true);
  }, [replaceRun]);

  const loadOlder = useCallback(() => {
    const { start, messages } = current.current;
    if (!worker.current || historyPending.current || start === 0 || messages.length >= MAX_HISTORY)
      return;
    historyPending.current = true;
    worker.current.postMessage({
      kind: "history",
      id: ++historyId.current,
      before: start,
    } satisfies WorkerRequest);
  }, []);

  const loadMoreResults = useCallback(() => {
    if (!worker.current || nextResult === null || loadingResults) return;
    const id = ++searchId.current;
    activeSearch.current = { id, append: true };
    setLoadingResults(true);
    worker.current.postMessage({
      kind: "search",
      id,
      query,
      from: nextResult,
    } satisfies WorkerRequest);
  }, [nextResult, loadingResults, query]);

  return {
    chat,
    ready,
    query,
    setQuery,
    searching,
    displayed,
    moreResults: nextResult !== null,
    loadingResults,
    loadMoreResults,
    following,
    held,
    setHeld,
    setFollowing,
    log,
    reset,
    clearWindow,
    loadOlder,
    historyFull: run.start > 0 && run.messages.length >= MAX_HISTORY,
    activity,
  };
}
