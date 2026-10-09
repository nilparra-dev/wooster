import type { ArchiveInfo, ChatMessage } from "./archive";

export type WorkerRequest =
  | { kind: "load"; file: File }
  | { kind: "loadRemote"; url: string; size: number }
  | { kind: "window"; id: number; time: number }
  /** Messages before archive position `before`, for scrolling back. */
  | { kind: "history"; id: number; before: number }
  /** `from` resumes a search at an archive position; 0 starts it. */
  | { kind: "search"; id: number; query: string; from: number }
  | { kind: "activity"; id: number; start: number; end: number; buckets: number };

export type WorkerResponse =
  | { kind: "progress"; percent: number }
  | { kind: "ready"; info: ArchiveInfo }
  | { kind: "window"; id: number; start: number; messages: ChatMessage[] }
  | { kind: "history"; id: number; start: number; messages: ChatMessage[] }
  | { kind: "search"; id: number; messages: ChatMessage[]; next: number | null }
  | { kind: "activity"; id: number; counts: number[] }
  | { kind: "error"; message: string };
