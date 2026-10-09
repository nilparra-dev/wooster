import {
  number,
  parseStoredMessage,
  record,
  string,
  type ChatMessage,
} from "@chat-protocol";

export type { ChatMessage } from "@chat-protocol";
export interface ReplayFile {
  size: number;
  slice(start?: number, end?: number): Pick<Blob, "arrayBuffer">;
}
export interface ArchiveInfo {
  vodId: string;
  title: string;
  count: number;
  status: "complete" | "empty" | "partial";
}
interface Entry {
  start: number;
  end: number;
  time: number;
}
export interface ArchiveIndex {
  file: ReplayFile;
  entries: Entry[];
  info: ArchiveInfo;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const whitespace = (byte: number) => byte === 32 || byte === 10 || byte === 13 || byte === 9;

// Scan the JSON structurally as UTF-8 bytes. Keep only one message in memory and
// index its byte range; multibyte text must not shift subsequent file offsets.
export async function indexArchive(
  file: ReplayFile,
  progress: (percent: number) => void = () => {},
): Promise<ArchiveIndex> {
  const entries: Entry[] = [];
  const ids = new Set<string>();
  const metadata: number[] = [];
  let message: number[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let token: number[] = [];
  let lastString = "";
  let key = "";
  let insideMessages = false;
  let foundMessages = false;
  let messageStart = -1;
  let arrayState: "first" | "value" | "separator" = "first";
  const chunkSize = 256 * 1024;
  if (file.size > 4 * 1024 ** 3)
    throw new Error("Chat files larger than 4 GB are not supported yet.");
  for (let base = 0; base < file.size; base += chunkSize) {
    const chunk = new Uint8Array(await file.slice(base, base + chunkSize).arrayBuffer());
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const byte = chunk[offset];
      const position = base + offset;
      if (!insideMessages) metadata.push(byte);
      else if (messageStart >= 0) message.push(byte);
      if (metadata.length > 1024 * 1024 || message.length > 1024 * 1024)
        throw new Error("Chat metadata or a message exceeds the 1 MB limit.");
      if (quoted) {
        if (depth === 1) token.push(byte);
        if (escaped) escaped = false;
        else if (byte === 92) escaped = true;
        else if (byte === 34) {
          quoted = false;
          if (depth === 1) lastString = string(JSON.parse(decoder.decode(new Uint8Array(token))));
        }
        continue;
      }
      if (insideMessages && depth === 2 && messageStart < 0) {
        if (whitespace(byte)) continue;
        if (byte === 93) {
          if (arrayState === "value") throw new Error("Invalid trailing comma in chat messages.");
          insideMessages = false;
          depth -= 1;
          metadata.push(byte);
          continue;
        }
        if (arrayState === "separator") {
          if (byte !== 44) throw new Error("Expected a comma between chat messages.");
          arrayState = "value";
          continue;
        }
        if (byte !== 123) throw new Error("Each chat message must be an object.");
        messageStart = position;
        message = [byte];
      }
      if (byte === 34) {
        quoted = true;
        token = [byte];
      } else if (byte === 58 && depth === 1) {
        key = lastString;
      } else if (byte === 123 || byte === 91) {
        if (depth === 1 && byte === 91 && key === "messages") {
          if (foundMessages) throw new Error("Duplicate messages array.");
          insideMessages = true;
          foundMessages = true;
        }
        depth += 1;
      } else if (byte === 125 || byte === 93) {
        depth -= 1;
        if (insideMessages && depth === 2 && messageStart >= 0) {
          const parsed = parseStoredMessage(JSON.parse(decoder.decode(new Uint8Array(message))));
          if (ids.has(parsed.id)) throw new Error("Chat contains duplicate message IDs.");
          const previous = entries[entries.length - 1];
          if (previous && parsed.offsetSeconds < previous.time)
            throw new Error("Chat messages are not in chronological order.");
          ids.add(parsed.id);
          entries.push({ start: messageStart, end: position + 1, time: parsed.offsetSeconds });
          if (entries.length > 2_000_000)
            throw new Error("This chat exceeds the two million message limit.");
          messageStart = -1;
          message = [];
          arrayState = "separator";
        }
      }
    }
    progress(Math.min(100, Math.floor(((base + chunk.length) / file.size) * 100)));
  }
  if (!foundMessages || insideMessages || quoted || depth !== 0)
    throw new Error(
      "Chat JSON is incomplete or has no messages array. Select the exported chat.json file.",
    );
  const root = record(JSON.parse(decoder.decode(new Uint8Array(metadata))));
  if (root.schemaVersion !== 1 || root.coverage !== "available-replay")
    throw new Error("Unsupported chat format. Use the JSON exported by twitch-m3u8 chat.");
  if (root.status !== "complete" && root.status !== "empty" && root.status !== "partial")
    throw new Error("This file does not contain a playable chat archive.");
  if (number(root.messageCount) !== entries.length)
    throw new Error("Chat message count does not match the file. The export may be incomplete.");
  const video = root.video === null ? null : record(root.video);
  return {
    file,
    entries,
    info: {
      vodId: string(root.vodId),
      title: video === null ? `VOD ${string(root.vodId)}` : string(video.title),
      count: entries.length,
      status: root.status,
    },
  };
}

/** Number of entries strictly before `time`. */
function lowerBound(entries: readonly { time: number }[], time: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function upperBound(entries: readonly { time: number }[], time: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

async function readEntries(
  index: ArchiveIndex,
  start: number,
  end: number,
): Promise<ChatMessage[]> {
  if (start === end) return [];
  const first = index.entries[start];
  const last = index.entries[end - 1];
  const bytes = new Uint8Array(await index.file.slice(first.start, last.end).arrayBuffer());
  return index.entries
    .slice(start, end)
    .map((entry) =>
      parseStoredMessage(
        JSON.parse(
          decoder.decode(bytes.subarray(entry.start - first.start, entry.end - first.start)),
        ),
      ),
    );
}


/** A run of consecutive messages and the archive position of its first one. */
export interface MessageRun {
  start: number;
  messages: ChatMessage[];
}

const MAX_RUN = 100;

function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN)
    throw new Error("Invalid replay window.");
}

/** The last `limit` messages sent at or before `time`. */
export async function readWindow(
  index: ArchiveIndex,
  time: number,
  limit = 80,
): Promise<MessageRun> {
  if (!Number.isFinite(time)) throw new Error("Invalid replay window.");
  checkLimit(limit);
  const end = upperBound(index.entries, time);
  const start = Math.max(0, end - limit);
  return { start, messages: await readEntries(index, start, end) };
}

/** The `limit` messages that precede archive position `before`. */
export async function readBefore(
  index: ArchiveIndex,
  before: number,
  limit = 80,
): Promise<MessageRun> {
  if (!Number.isInteger(before) || before < 0) throw new Error("Invalid replay window.");
  checkLimit(limit);
  const end = Math.min(before, index.entries.length);
  const start = Math.max(0, end - limit);
  return { start, messages: await readEntries(index, start, end) };
}

/**
 * Count messages per equal slice of the replay clock, from `start` to `end`
 * inclusive. Reads only the index, so it costs no file access.
 */
export function messageActivity(
  index: ArchiveIndex,
  start: number,
  end: number,
  buckets: number,
): number[] {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isInteger(buckets) ||
    buckets < 1 ||
    buckets > 1000
  )
    throw new Error("Invalid activity range.");
  const width = (end - start) / buckets;
  const counts: number[] = [];
  let previous = lowerBound(index.entries, start);
  for (let bucket = 1; bucket <= buckets; bucket += 1) {
    // The last edge is `end` itself, not a sum that rounding could move.
    const edge = upperBound(index.entries, bucket === buckets ? end : start + width * bucket);
    counts.push(edge - previous);
    previous = edge;
  }
  return counts;
}

export interface SearchQuery {
  /** Exact login or display name from a `from:name` term, lowercased. */
  user: string | null;
  /** Remaining text, lowercased. */
  text: string;
}

/** Split a search box value into its `from:name` filter and free text. */
export function parseSearchQuery(query: string): SearchQuery {
  let user: string | null = null;
  const words: string[] = [];
  for (const word of query.trim().split(/\s+/)) {
    const name = /^from:(.+)$/i.exec(word)?.[1];
    if (name && user === null) user = name.toLocaleLowerCase();
    else if (word) words.push(word);
  }
  return { user, text: words.join(" ").toLocaleLowerCase() };
}

// Without a `from:` filter the text may match the author as well, so typing a
// name finds that person's messages. With one, the text narrows their messages.
function matches(message: ChatMessage, query: SearchQuery): boolean {
  const login = message.user?.login.toLocaleLowerCase() ?? "";
  const name = message.user?.displayName.toLocaleLowerCase() ?? "";
  const text = message.text.toLocaleLowerCase();
  if (query.user === null) return `${name} ${login} ${text}`.includes(query.text);
  return (query.user === login || query.user === name) && text.includes(query.text);
}

export interface SearchPage {
  messages: ChatMessage[];
  /** Archive position to resume from, or null when the archive is exhausted. */
  next: number | null;
}

export const SEARCH_PAGE_SIZE = 100;

/**
 * Scan the archive in order from position `from` and return the next page of
 * matches. A cancelled or empty search returns an empty, exhausted page.
 */
export async function searchArchive(
  index: ArchiveIndex,
  query: string,
  cancelled: () => boolean,
  from = 0,
): Promise<SearchPage> {
  const parsed = parseSearchQuery(query);
  const none: SearchPage = { messages: [], next: null };
  if (!parsed.text && parsed.user === null) return none;
  if (!Number.isInteger(from) || from < 0) throw new Error("Invalid search position.");
  const found: ChatMessage[] = [];
  const batchSize = 80;
  // Read batches in order but keep a few range reads in flight, so a remote
  // archive is not scanned one HTTP request at a time.
  const lookahead = 4;
  const pending: Array<{ start: number; batch: Promise<ChatMessage[]> }> = [];
  let next = from;
  const fill = () => {
    while (pending.length < lookahead && next < index.entries.length) {
      const start = next;
      next += batchSize;
      const batch = readEntries(index, start, Math.min(next, index.entries.length));
      // A page can fill, or the search be cancelled, before the batches read
      // ahead of it are awaited; their failures then have no one to report to.
      batch.catch(() => undefined);
      pending.push({ start, batch });
    }
  };
  fill();
  for (;;) {
    if (cancelled()) return none;
    const current = pending.shift();
    if (!current) return { messages: found, next: null };
    fill();
    const batch = await current.batch;
    for (let offset = 0; offset < batch.length; offset += 1) {
      if (cancelled()) return none;
      const message = batch[offset];
      if (!matches(message, parsed)) continue;
      found.push(message);
      if (found.length === SEARCH_PAGE_SIZE) {
        const resume = current.start + offset + 1;
        return { messages: found, next: resume < index.entries.length ? resume : null };
      }
    }
  }
}
