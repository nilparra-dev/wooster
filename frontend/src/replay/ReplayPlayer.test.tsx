import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplayPlayer } from "./ReplayPlayer";
import type { WorkerRequest, WorkerResponse } from "./protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: WorkerRequest[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: WorkerRequest) {
    this.sent.push(message);
  }
  emit(data: WorkerResponse) {
    act(() => this.onmessage?.(new MessageEvent("message", { data })));
  }
  last<K extends WorkerRequest["kind"]>(kind: K) {
    const request = [...this.sent].reverse().find((item) => item.kind === kind);
    if (!request) throw new Error(`No ${kind} request`);
    return request as Extract<WorkerRequest, { kind: K }>;
  }
  lastWindow() {
    return this.last("window");
  }
}
const revoke = vi.fn();
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  const NativeURL = URL;
  let id = 0;
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL() {
        return `blob:test-${++id}`;
      }
      static revokeObjectURL = revoke;
    },
  );
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");
});

// A fixed modification time: it is part of how the player identifies a file.
const recording = () =>
  new File(["media"], "recording.mp4", { type: "video/mp4", lastModified: 1 });
function currentVideo() {
  const video = screen.getByLabelText("Archived video");
  if (!(video instanceof HTMLVideoElement)) throw new Error("Expected a video");
  Object.defineProperty(video, "duration", { configurable: true, value: 100 });
  return video;
}
function openVideo() {
  fireEvent.change(screen.getByLabelText("Video file"), { target: { files: [recording()] } });
  return currentVideo();
}
function openChat() {
  fireEvent.change(screen.getByLabelText("Add archived chat"), {
    target: { files: [new File(["chat"], "chat.json")] },
  });
  const worker = FakeWorker.instances[FakeWorker.instances.length - 1];
  worker.emit({
    kind: "ready",
    info: { vodId: "123", title: "Broadcast", count: 1, status: "complete" },
  });
  return worker;
}
const message = {
  id: "message",
  offsetSeconds: 5,
  createdAt: "2026-09-01",
  user: null,
  text: "Message at five",
  fragments: [],
  badges: [],
  color: null,
};
const numbered = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => ({
    ...message,
    id: String(from + index),
    offsetSeconds: 0,
    text: `Line ${from + index}`,
  }));
function choose(setting: string, option: string) {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${setting}`) }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: option }));
}

describe("local replay controls", () => {
  it("uses media time plus the selected offset, including negative times", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    const worker = openChat();
    expect(worker.lastWindow().time).toBe(0);
    video.currentTime = 10;
    fireEvent.timeUpdate(video);
    expect(worker.lastWindow().time).toBe(10);
    fireEvent.change(screen.getByLabelText("Chat offset in seconds"), { target: { value: "-20" } });
    expect(worker.lastWindow().time).toBe(-10);
    choose("Playback speed", "2×");
    expect(video.playbackRate).toBe(2);
    // A speed change must not invent elapsed video time.
    expect(worker.lastWindow().time).toBe(-10);
  });
  it("discards stale worker replies after seeking backwards", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    const worker = openChat();
    video.currentTime = 10;
    fireEvent.timeUpdate(video);
    const old = worker.lastWindow();
    worker.emit({ kind: "window", id: old.id, start: 0, messages: [message] });
    expect(screen.getByText("Message at five")).toBeInTheDocument();
    video.currentTime = 1;
    fireEvent.seeking(video);
    worker.emit({ kind: "window", id: old.id, start: 0, messages: [message] });
    expect(screen.queryByText("Message at five")).not.toBeInTheDocument();
    expect(worker.lastWindow().time).toBe(1);
  });
  it("seeks from a chat timestamp while applying the sync offset", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    const worker = openChat();
    fireEvent.change(screen.getByLabelText("Chat offset in seconds"), { target: { value: "2" } });
    video.currentTime = 5;
    fireEvent.timeUpdate(video);
    worker.emit({ kind: "window", id: worker.lastWindow().id, start: 0, messages: [message] });
    fireEvent.click(screen.getByRole("button", { name: "Jump to 0:05" }));
    expect(video.currentTime).toBe(3);
  });
  it("retains video when chat fails or is removed, and terminates the reader", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    const worker = openChat();
    worker.emit({ kind: "error", message: "Malformed archive" });
    expect(screen.getByRole("alert")).toHaveTextContent("Malformed archive");
    expect(screen.getByLabelText("Archived video")).toBe(video);
    fireEvent.click(screen.getByRole("button", { name: "Remove chat" }));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Archived video")).toBe(video);
  });
  it("releases object URLs and exits theater mode with Escape", () => {
    const view = render(<ReplayPlayer />);
    openVideo();
    fireEvent.click(screen.getByRole("button", { name: "Theater mode" }));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Theater mode" })).toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:test-1");
  });
});

describe("chat history and search", () => {
  function scrollLog(top: number) {
    const log = screen.getByRole("log");
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 400 },
    });
    log.scrollTop = top;
    fireEvent.scroll(log);
  }
  it("loads the messages before the window when the viewer scrolls back", () => {
    render(<ReplayPlayer />);
    openVideo();
    const worker = openChat();
    worker.emit({
      kind: "window",
      id: worker.lastWindow().id,
      start: 80,
      messages: numbered(80, 160),
    });
    expect(screen.getByText("Following video time")).toBeInTheDocument();
    scrollLog(100);
    expect(screen.getByText("Paused while you scroll")).toBeInTheDocument();
    const history = worker.last("history");
    expect(history.before).toBe(80);
    // One request at a time: more scrolling does not pile them up.
    scrollLog(90);
    expect(worker.sent.filter((item) => item.kind === "history")).toHaveLength(1);
    worker.emit({ kind: "history", id: history.id, start: 0, messages: numbered(0, 80) });
    expect(screen.getByText("Line 0")).toBeInTheDocument();
    expect(screen.getByText("Line 159")).toBeInTheDocument();
    // Nothing precedes position 0, so the top is final.
    scrollLog(80);
    expect(worker.sent.filter((item) => item.kind === "history")).toHaveLength(1);
  });
  it("drops a history reply that arrives after the window was replaced", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    const worker = openChat();
    worker.emit({
      kind: "window",
      id: worker.lastWindow().id,
      start: 80,
      messages: numbered(80, 160),
    });
    scrollLog(100);
    const history = worker.last("history");
    video.currentTime = 50;
    fireEvent.seeking(video);
    worker.emit({ kind: "history", id: history.id, start: 0, messages: numbered(0, 80) });
    expect(screen.queryByText("Line 0")).not.toBeInTheDocument();
  });
  it("pages search results and marks the matched text", () => {
    vi.useFakeTimers();
    render(<ReplayPlayer />);
    openVideo();
    const worker = openChat();
    fireEvent.change(screen.getByLabelText("Search chat"), { target: { value: "line" } });
    act(() => void vi.advanceTimersByTime(300));
    const first = worker.last("search");
    expect(first).toMatchObject({ query: "line", from: 0 });
    worker.emit({ kind: "search", id: first.id, messages: numbered(0, 2), next: 40 });
    expect(screen.getAllByText("Line", { selector: "mark" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show more matches" }));
    const second = worker.last("search");
    expect(second).toMatchObject({ query: "line", from: 40 });
    worker.emit({ kind: "search", id: second.id, messages: numbered(40, 41), next: null });
    expect(screen.getAllByText("Line", { selector: "mark" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Show more matches" })).not.toBeInTheDocument();
  });
  it("filters by author when a name is clicked", () => {
    render(<ReplayPlayer />);
    openVideo();
    const worker = openChat();
    worker.emit({
      kind: "window",
      id: worker.lastWindow().id,
      start: 0,
      messages: [
        { ...message, offsetSeconds: 0, user: { id: "1", login: "wren", displayName: "Wren" } },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Show messages from Wren" }));
    expect(screen.getByLabelText("Search chat")).toHaveValue("from:wren");
    // The card counts what the search for that author found, and closes with it.
    const search = worker.last("search");
    worker.sent.length = 0;
    expect(screen.getByText("Finding their messages…")).toBeInTheDocument();
    worker.emit({ kind: "search", id: search.id, messages: [], next: null });
    expect(screen.getByText("Finding their messages…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close user card" }));
    expect(screen.getByLabelText("Search chat")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Close user card" })).not.toBeInTheDocument();
  });
  it("holds the chat still under a resting mouse and resumes when it leaves", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    const worker = openChat();
    const log = screen.getByRole("log");
    fireEvent.pointerEnter(log, { pointerType: "mouse" });
    expect(screen.getByText("Paused while you hover")).toBeInTheDocument();
    const before = worker.sent.length;
    video.currentTime = 10;
    fireEvent.timeUpdate(video);
    expect(worker.sent).toHaveLength(before);
    fireEvent.pointerLeave(log);
    expect(worker.lastWindow().time).toBe(10);
    // A finger on the log is not a resting pointer.
    fireEvent.pointerEnter(log, { pointerType: "touch" });
    expect(screen.getByText("Following video time")).toBeInTheDocument();
    // A seek empties the window, which must refill under the pointer.
    fireEvent.pointerEnter(log, { pointerType: "mouse" });
    video.currentTime = 40;
    fireEvent.seeking(video);
    expect(worker.lastWindow().time).toBe(40);
  });
});

describe("floating controls", () => {
  it("step aside while the video plays untouched and return on input", () => {
    vi.useFakeTimers();
    render(<ReplayPlayer />);
    const video = openVideo();
    const controls = screen.getByRole("group", { name: "Video controls" });
    act(() => void vi.advanceTimersByTime(5000));
    // A paused video keeps its controls, however long it waits.
    expect(controls).not.toHaveClass("is-idle");
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.play(video);
    act(() => void vi.advanceTimersByTime(2900));
    expect(controls).not.toHaveClass("is-idle");
    act(() => void vi.advanceTimersByTime(200));
    expect(controls).toHaveClass("is-idle");
    fireEvent.pointerMove(video);
    expect(controls).not.toHaveClass("is-idle");
  });
  it("stay while a menu is open or the keyboard is inside them", () => {
    vi.useFakeTimers();
    render(<ReplayPlayer />);
    const video = openVideo();
    const controls = screen.getByRole("group", { name: "Video controls" });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.play(video);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(controls).not.toHaveClass("is-idle");
    // Escape steps back through the menu before it closes it.
    fireEvent.click(screen.getByRole("menuitem", { name: /^Playback speed/ }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.getByRole("menuitem", { name: /^Playback speed/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // The menu returned focus to the gear by keyboard, so the bar still stays.
    act(() => void vi.advanceTimersByTime(10_000));
    expect(controls).not.toHaveClass("is-idle");
    fireEvent.pointerMove(video);
    act(() => void vi.advanceTimersByTime(3100));
    expect(controls).toHaveClass("is-idle");
  });
  it("are absent until a video is open", () => {
    render(<ReplayPlayer />);
    expect(screen.queryByRole("group", { name: "Video controls" })).not.toBeInTheDocument();
  });
});

describe("viewer conveniences", () => {
  it("plays with Space and the video, but leaves Space to a focused button", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    const play = vi.spyOn(video, "play").mockResolvedValue();
    fireEvent.keyDown(document.body, { key: " " });
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(video);
    expect(play).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("button", { name: "Theater mode" }), { key: " " });
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("changes volume with the arrow keys and seeks with J and L", () => {
    render(<ReplayPlayer />);
    const video = openVideo();
    fireEvent.loadedMetadata(video);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(video.volume).toBeCloseTo(0.95);
    fireEvent.keyDown(document.body, { key: "l" });
    expect(video.currentTime).toBe(10);
    fireEvent.timeUpdate(video);
    fireEvent.keyDown(document.body, { key: "J" });
    expect(video.currentTime).toBe(0);
    // The arrows scroll the chat log when it has focus.
    fireEvent.keyDown(screen.getByRole("log"), { key: "ArrowDown" });
    expect(video.volume).toBeCloseTo(0.95);
  });
  it("restores speed, volume and chat visibility on the next visit", () => {
    const first = render(<ReplayPlayer />);
    const video = openVideo();
    choose("Playback speed", "1.5×");
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide chat" }));
    expect(video.volume).toBeCloseTo(0.4);
    first.unmount();

    render(<ReplayPlayer />);
    const again = openVideo();
    fireEvent.loadedMetadata(again);
    expect(again.playbackRate).toBe(1.5);
    expect(again.volume).toBeCloseTo(0.4);
    expect(screen.getByRole("button", { name: "Show chat" })).toBeInTheDocument();
  });
  it("keeps the sync offset of each video and nudges it by a second", () => {
    const first = render(<ReplayPlayer />);
    openVideo();
    openChat();
    fireEvent.click(screen.getByRole("button", { name: "Show chat 1 second later" }));
    fireEvent.click(screen.getByRole("button", { name: "Show chat 1 second later" }));
    fireEvent.click(screen.getByRole("button", { name: "Show chat 1 second earlier" }));
    expect(screen.getByLabelText("Chat offset in seconds")).toHaveValue(1);
    first.unmount();

    render(<ReplayPlayer />);
    openVideo();
    expect(screen.getByLabelText("Chat offset in seconds")).toHaveValue(1);
    // Another file starts from zero.
    fireEvent.change(screen.getByLabelText("Video file"), {
      target: { files: [new File(["other"], "other.mp4")] },
    });
    expect(screen.getByLabelText("Chat offset in seconds")).toHaveValue(0);
  });
  it("opens a dropped video together with its chat", () => {
    render(<ReplayPlayer />);
    const player = screen.getByRole("region", { name: "Local replay player" });
    const chat = new File(["{}"], "chat.json", { type: "application/json" });
    fireEvent.drop(player, { dataTransfer: { types: ["Files"], files: [chat] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Open a video before adding its chat.");
    fireEvent.drop(player, { dataTransfer: { types: ["Files"], files: [chat, recording()] } });
    expect(screen.getByLabelText("Archived video")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const worker = FakeWorker.instances[FakeWorker.instances.length - 1];
    expect(worker.sent[0]).toMatchObject({ kind: "load", file: chat });
  });
});

describe("watch bridge", () => {
  const session = {
    revision: 1,
    input: "https://www.twitch.tv/videos/123?t=1m5s",
    state: "ready",
    error: null,
    title: "Twitch VOD 123",
    source: "public",
    formats: [
      { id: "1080p60", url: "/media/high" },
      { id: "480p", url: "/media/low" },
    ],
    chat: { kind: "downloading", messages: 1200, offsetSeconds: 25 },
  };
  const broadcast = {
    channel: { login: "chan", name: "Chan", avatar: "/api/avatar/chan.jpeg" },
    title: "Heist day",
    category: "Just Chatting",
    startedAt: "2026-10-09T18:42:37Z",
    chapters: [
      { start: 0, title: "Just Chatting" },
      { start: 50, title: "Grand Theft Auto V" },
    ],
    storyboard: null,
  };
  function serve(current: Omit<typeof session, "chat"> & { chat: object }) {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("api/session")
        ? { ok: true, json: async () => current }
        : url.includes("api/broadcast?")
          ? { ok: true, json: async () => broadcast }
          : { ok: true, json: async () => ({ accepted: true }) },
    );
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", `/${"a".repeat(48)}/`);
    return fetchMock;
  }
  it("starts at the linked time and lists the broadcast as recent", async () => {
    serve(session);
    render(<ReplayPlayer />);
    const video = await waitFor(currentVideo);
    // The start time is not part of the broadcast's identity.
    expect(screen.getByLabelText("Open a broadcast")).toHaveValue(
      "https://www.twitch.tv/videos/123",
    );
    localStorage.setItem("replay:stream:https://www.twitch.tv/videos/123", "40");
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(65);
    fireEvent.durationChange(video);
    // The count is formatted for the viewer's locale, so only the share is matched.
    expect(screen.getByText(/messages saved \(25%\)/)).toBeInTheDocument();
    // Twitch's title replaces the session's placeholder once it is known.
    await screen.findByRole("heading", { name: "Heist day" });
    fireEvent.pause(video);
    expect(JSON.parse(localStorage.getItem("replay:recent") ?? "[]")).toEqual([
      {
        input: "https://www.twitch.tv/videos/123",
        title: "Heist day",
        time: 65,
        duration: 100,
      },
    ]);
  });
  it("names the broadcast, its channel and the chapter being played", async () => {
    serve({ ...session, input: "https://www.twitch.tv/videos/123" });
    const { container } = render(<ReplayPlayer />);
    const video = await waitFor(currentVideo);
    expect(await screen.findByRole("heading", { name: "Heist day" })).toBeInTheDocument();
    expect(screen.getByText("Chan")).toBeInTheDocument();
    expect(container.querySelector(".replay-avatar")).toHaveAttribute(
      "src",
      "/api/avatar/chan.jpeg",
    );
    const details = container.querySelector(".replay-metadata");
    expect(details).toHaveTextContent("Just Chatting");
    fireEvent.loadedMetadata(video);
    video.currentTime = 60;
    fireEvent.timeUpdate(video);
    expect(details).toHaveTextContent("Grand Theft Auto V");
    expect(details).not.toHaveTextContent("Just Chatting");
    // The recent list remembers the stream by its title, not its number.
    expect(JSON.parse(localStorage.getItem("replay:recent") ?? "[]")[0].title).toBe("Heist day");
  });
  it("shows why watch chat is unavailable without hiding it", async () => {
    serve({
      ...session,
      chat: { kind: "unavailable", message: "Twitch no longer exposes chat for this VOD." },
    });
    render(<ReplayPlayer />);
    expect(await screen.findByRole("heading", { name: "Chat is unavailable" })).toBeInTheDocument();
    const reason = screen.getByText("Twitch no longer exposes chat for this VOD.");
    expect(reason).toHaveAttribute("role", "alert");
    expect(reason).toBeVisible();
  });
  it("labels Twitch's source and audio renditions in the quality setting", async () => {
    serve({
      ...session,
      formats: [
        { id: "chunked", url: "/media/source" },
        { id: "audio_only", url: "/media/audio" },
      ],
    });
    render(<ReplayPlayer />);
    await waitFor(currentVideo);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("menuitem", { name: /^Video quality/ })).toHaveTextContent("Source");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Video quality/ }));
    expect(screen.getByRole("menuitemradio", { name: "Audio only" })).toBeInTheDocument();
  });
  it("keeps playing from the same position after a quality change", async () => {
    serve({ ...session, input: "https://www.twitch.tv/videos/123" });
    render(<ReplayPlayer />);
    const video = await waitFor(currentVideo);
    fireEvent.loadedMetadata(video);
    video.currentTime = 30;
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    choose("Video quality", "480p");
    const next = currentVideo();
    expect(next).not.toBe(video);
    const play = vi.spyOn(next, "play").mockResolvedValue();
    fireEvent.loadedMetadata(next);
    expect(next.currentTime).toBe(30);
    expect(play).toHaveBeenCalledOnce();
  });
  it("offers recent broadcasts and reopens one", async () => {
    localStorage.setItem(
      "replay:recent",
      JSON.stringify([
        { input: "https://www.twitch.tv/videos/9", title: "Finale", time: 90, duration: 3700 },
        { input: 7, title: "Corrupt entry" },
      ]),
    );
    const fetchMock = serve({ ...session, state: "idle", input: "", formats: [] });
    render(<ReplayPlayer />);
    const entry = await screen.findByRole("button", { name: /Finale/ });
    expect(entry).toHaveTextContent("1:30 / 1:01:40");
    expect(screen.queryByText("Corrupt entry")).not.toBeInTheDocument();
    fireEvent.click(entry);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/api\/resolve$/),
        expect.objectContaining({
          body: JSON.stringify({ input: "https://www.twitch.tv/videos/9" }),
        }),
      ),
    );
  });
});
