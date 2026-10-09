// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  indexArchive,
  messageActivity,
  parseSearchQuery,
  readBefore,
  readWindow,
  searchArchive,
  upperBound,
  type ChatMessage,
} from "./archive";

const message = (id: string, offsetSeconds: number, text = "hello"): ChatMessage => ({
  id,
  offsetSeconds,
  text,
  createdAt: "2026-09-01T12:00:00Z",
  user: null,
  color: null,
  fragments: [{ text, emoteId: null }],
  badges: [],
});
const from = (login: string, base: ChatMessage): ChatMessage => ({
  ...base,
  user: { id: login, login, displayName: login[0].toUpperCase() + login.slice(1) },
});
const archive = (
  messages = [message("a", 0), message("b", 5), message("c", 5), message("d", 20)],
) => ({
  schemaVersion: 1,
  vodId: "123",
  video: { title: "Test archive" },
  coverage: "available-replay",
  status: "complete",
  messageCount: messages.length,
  messages,
});
const file = (data: unknown) => new Blob([JSON.stringify(data)]);
const windowAt = async (...args: Parameters<typeof readWindow>) =>
  (await readWindow(...args)).messages;

describe("streaming chat index", () => {
  it("indexes exported JSON without retaining message text in entries", async () => {
    const data = archive();
    const index = await indexArchive(file(data));
    expect(index.info).toEqual({
      vodId: "123",
      title: "Test archive",
      count: 4,
      status: "complete",
    });
    expect(index.entries[0]).not.toHaveProperty("text");
    expect(await windowAt(index, 5)).toEqual(data.messages.slice(0, 3));
  });
  it("handles UTF-8, escaped quotes/braces and chunk boundaries", async () => {
    const messages = Array.from({ length: 1600 }, (_, i) =>
      message(String(i), i, `Español 日本語 🚀 {"messages":[ ]} \\ ${"x".repeat(150)}`),
    );
    const data = new Blob([JSON.stringify(archive(messages), null, 2)]);
    const progress: number[] = [];
    const index = await indexArchive(data, (value) => progress.push(value));
    expect(progress.length).toBeGreaterThan(2);
    expect(progress[progress.length - 1]).toBe(100);
    expect(await windowAt(index, 1599, 3)).toEqual(messages.slice(-3));
    expect(await windowAt(index, 350, 1)).toEqual([messages[350]]);
  });
  it("supports metadata after messages and a null deleted-VOD metadata record", async () => {
    const data = archive();
    const { messages, ...metadata } = data;
    const index = await indexArchive(file({ messages, ...metadata, video: null }));
    expect(index.info.title).toBe("VOD 123");
    expect(await windowAt(index, 0)).toEqual([messages[0]]);
  });
  it("rebuilds the window on backwards seeks and includes every equal-time message", async () => {
    const data = archive();
    const index = await indexArchive(file(data));
    expect(await windowAt(index, 100)).toEqual(data.messages);
    expect(await windowAt(index, 5)).toEqual(data.messages.slice(0, 3));
    expect(await windowAt(index, -1)).toEqual([]);
    expect(await windowAt(index, 4)).toEqual(data.messages.slice(0, 1));
  });
  it("caps the rendered window independently of archive size", async () => {
    const messages = Array.from({ length: 5000 }, (_, i) => message(String(i), i));
    const index = await indexArchive(file(archive(messages)));
    expect(await readWindow(index, 4999)).toEqual({ start: 4920, messages: messages.slice(-80) });
    expect(upperBound(index.entries, 2500)).toBe(2501);
  });
  it("reads the messages before a position until the archive starts", async () => {
    const messages = Array.from({ length: 200 }, (_, i) => message(String(i), i));
    const index = await indexArchive(file(archive(messages)));
    expect(await readBefore(index, 120)).toEqual({ start: 40, messages: messages.slice(40, 120) });
    expect(await readBefore(index, 40)).toEqual({ start: 0, messages: messages.slice(0, 40) });
    expect(await readBefore(index, 0)).toEqual({ start: 0, messages: [] });
    // A position past the end is clamped: it cannot read beyond the archive.
    expect((await readBefore(index, 999, 2)).messages).toEqual(messages.slice(-2));
    await expect(readBefore(index, -1)).rejects.toThrow();
    await expect(readBefore(index, 10, 101)).rejects.toThrow();
  });
  it("counts messages per slice of the replay clock, edges included", async () => {
    // Offsets 0, 5, 5 and 20 over [0, 20] in four 5-second slices.
    const index = await indexArchive(file(archive()));
    expect(messageActivity(index, 0, 20, 4)).toEqual([3, 0, 0, 1]);
    // A sync offset moves the range: only the message at 20 is inside [10, 30].
    expect(messageActivity(index, 10, 30, 2)).toEqual([1, 0]);
    expect(messageActivity(index, 0, 20, 1)).toEqual([4]);
    expect(() => messageActivity(index, 20, 20, 4)).toThrow();
    expect(() => messageActivity(index, 0, 20, 0)).toThrow();
    expect(() => messageActivity(index, 0, 20, 1001)).toThrow();
  });
  it("searches message content and users without loading the entire file", async () => {
    const messages = [message("a", 0, "one"), from("person", message("b", 2, "two"))];
    const index = await indexArchive(file(archive(messages)));
    const search = async (query: string, cancelled = false) =>
      (await searchArchive(index, query, () => cancelled)).messages;
    expect(await search("PERSON")).toEqual([messages[1]]);
    expect(await search("one")).toEqual([messages[0]]);
    expect(await search("one", true)).toEqual([]);
    expect(await search("   ")).toEqual([]);
  });
  it("filters by author with from:name and narrows by the remaining text", async () => {
    const messages = [
      from("wren", message("a", 0, "gg everyone")),
      from("wrenfan", message("b", 1, "wren is cracked")),
      from("wren", message("c", 2, "last split")),
    ];
    const index = await indexArchive(file(archive(messages)));
    const search = async (query: string) =>
      (await searchArchive(index, query, () => false)).messages;
    // The name is exact, so a longer login or a mention does not match.
    expect(await search("from:wren")).toEqual([messages[0], messages[2]]);
    expect(await search("FROM:Wren split")).toEqual([messages[2]]);
    expect(await search("from:nobody")).toEqual([]);
    expect(parseSearchQuery("  last from:Wren  split ")).toEqual({
      user: "wren",
      text: "last split",
    });
  });
  it("pages matches and resumes exactly after the last one returned", async () => {
    // 250 matches spread over 500 messages, so pages end in the middle of a batch.
    const messages = Array.from({ length: 500 }, (_, i) =>
      message(String(i), i, i % 2 ? "match" : "other"),
    );
    const index = await indexArchive(file(archive(messages)));
    const matching = messages.filter((item) => item.text === "match");
    const pages: ChatMessage[][] = [];
    let next: number | null = 0;
    while (next !== null) {
      const page = await searchArchive(index, "match", () => false, next);
      pages.push(page.messages);
      next = page.next;
    }
    expect(pages.map((page) => page.length)).toEqual([100, 100, 50]);
    expect(pages.flat()).toEqual(matching);
    // A page that ends on the last message has nothing to resume.
    const exact = await indexArchive(file(archive(matching.slice(0, 100))));
    expect((await searchArchive(exact, "match", () => false)).next).toBeNull();
    await expect(searchArchive(index, "match", () => false, -1)).rejects.toThrow();
  });
  it("distinguishes empty/partial archives and rejects incomplete or corrupt exports", async () => {
    const empty = await indexArchive(file({ ...archive([]), status: "empty" }));
    expect(await windowAt(empty, 10)).toEqual([]);
    expect((await indexArchive(file({ ...archive(), status: "partial" }))).info.status).toBe(
      "partial",
    );
    for (const invalid of [
      { ...archive(), schemaVersion: 2 },
      { ...archive(), messageCount: 99 },
      archive([message("a", 5), message("b", 1)]),
      archive([message("a", 1), message("a", 2)]),
      { ...archive(), messages: "not an array" },
      { ...archive(), messages: [null] },
    ])
      await expect(indexArchive(file(invalid))).rejects.toThrow();
    await expect(
      indexArchive(new Blob([JSON.stringify(archive()).slice(0, -3)])),
    ).rejects.toThrow();
    await expect(
      indexArchive(new Blob([JSON.stringify(archive()).replace(/\]\}$/, ",]}")])),
    ).rejects.toThrow();
  });
});
