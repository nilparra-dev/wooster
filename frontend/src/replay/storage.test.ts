import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecent,
  loadChatOffset,
  loadPreferences,
  loadRecent,
  rememberRecent,
  saveChatOffset,
  savePreferences,
} from "./storage";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("viewer storage", () => {
  it("merges saved preferences and ignores values it would not have written", () => {
    const defaults = { volume: 1, muted: false, speed: 1, chatVisible: true, chatWidth: null };
    expect(loadPreferences()).toEqual(defaults);
    savePreferences({ volume: 0.3, speed: 1.5 });
    savePreferences({ muted: true });
    expect(loadPreferences()).toEqual({ ...defaults, volume: 0.3, muted: true, speed: 1.5 });
    savePreferences({ chatWidth: 420 });
    expect(loadPreferences().chatWidth).toBe(420);
    localStorage.setItem(
      "replay:preferences",
      JSON.stringify({ volume: 7, muted: "yes", speed: 16, chatVisible: false, chatWidth: 9000 }),
    );
    expect(loadPreferences()).toEqual({ ...defaults, chatVisible: false });
    for (const stored of ["not json", "null", "[]", '"text"']) {
      localStorage.setItem("replay:preferences", stored);
      expect(loadPreferences().volume, stored).toBe(1);
    }
  });
  it("keeps one chat offset per video and none without a video", () => {
    saveChatOffset("replay:a", -12.5);
    saveChatOffset("", 9);
    expect(loadChatOffset("replay:a")).toBe(-12.5);
    expect(loadChatOffset("replay:b")).toBe(0);
    expect(loadChatOffset("")).toBe(0);
    localStorage.setItem("replay:a:offset", "900000");
    expect(loadChatOffset("replay:a")).toBe(0);
  });
  it("orders recent broadcasts by use, bounds the list and merges progress", () => {
    for (let i = 1; i <= 8; i += 1) rememberRecent(`vod-${i}`, { title: `Stream ${i}` });
    expect(loadRecent().map((item) => item.input)).toEqual([
      "vod-8",
      "vod-7",
      "vod-6",
      "vod-5",
      "vod-4",
      "vod-3",
    ]);
    rememberRecent("vod-5", { time: 30, duration: 600 });
    expect(loadRecent()[0]).toEqual({ input: "vod-5", title: "Stream 5", time: 30, duration: 600 });
    // Progress alone never adds a broadcast that was not opened through the list.
    rememberRecent("unknown", { time: 5, duration: 10 });
    expect(loadRecent().some((item) => item.input === "unknown")).toBe(false);
    clearRecent();
    expect(loadRecent()).toEqual([]);
  });
  it("drops malformed recent entries instead of failing", () => {
    localStorage.setItem(
      "replay:recent",
      JSON.stringify([
        { input: "ok", title: "Kept", time: 1, duration: 2 },
        { input: "", title: "Empty target", time: 1, duration: 2 },
        { input: "negative", title: "Bad time", time: -1, duration: 2 },
        { input: 4, title: "Bad target", time: 1, duration: 2 },
        null,
      ]),
    );
    expect(loadRecent()).toEqual([{ input: "ok", title: "Kept", time: 1, duration: 2 }]);
  });
  it("works when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => savePreferences({ speed: 2 })).not.toThrow();
    expect(loadPreferences().speed).toBe(1);
    expect(loadRecent()).toEqual([]);
  });
});
