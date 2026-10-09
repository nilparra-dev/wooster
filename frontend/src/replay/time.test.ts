// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatStartTime, parseStartTime, shortClock, splitStartTime, withStartTime } from "./time";

describe("replay clocks", () => {
  it("drops the hour from the compact clock until it is needed", () => {
    expect(shortClock(0)).toBe("0:00");
    expect(shortClock(65.9)).toBe("1:05");
    expect(shortClock(3599)).toBe("59:59");
    expect(shortClock(3600)).toBe("1:00:00");
    expect(shortClock(36_061)).toBe("10:01:01");
    expect(shortClock(-4)).toBe("0:00");
    expect(shortClock(Number.NaN)).toBe("0:00");
  });
  it("reads Twitch start times and rejects anything else", () => {
    expect(parseStartTime("1h2m3s")).toBe(3723);
    expect(parseStartTime("90m")).toBe(5400);
    expect(parseStartTime("45s")).toBe(45);
    expect(parseStartTime("45")).toBe(45);
    expect(parseStartTime("2h")).toBe(7200);
    for (const invalid of ["", "abc", "1h2x", "-5", "1.5", "3s2m", "1h 2m"])
      expect(parseStartTime(invalid), invalid).toBeNull();
  });
  it("writes start times that it reads back", () => {
    expect(formatStartTime(3723)).toBe("1h2m3s");
    expect(formatStartTime(3600)).toBe("1h0m0s");
    expect(formatStartTime(65.8)).toBe("1m5s");
    expect(formatStartTime(0)).toBe("0s");
    for (const seconds of [0, 59, 60, 3599, 3600, 86_399])
      expect(parseStartTime(formatStartTime(seconds))).toBe(seconds);
  });
  it("separates the start time from the broadcast it points into", () => {
    expect(splitStartTime(" https://www.twitch.tv/videos/123?t=1h2m3s ")).toEqual({
      input: "https://www.twitch.tv/videos/123",
      start: 3723,
    });
    // Other parameters, and a `t` that is not a time, belong to the target.
    expect(splitStartTime("https://tracker.test/vod?id=7&t=5m")).toEqual({
      input: "https://tracker.test/vod?id=7",
      start: 300,
    });
    expect(splitStartTime("https://tracker.test/vod?t=token")).toEqual({
      input: "https://tracker.test/vod?t=token",
      start: null,
    });
    expect(splitStartTime("video:channel_1_2")).toEqual({
      input: "video:channel_1_2",
      start: null,
    });
    expect(splitStartTime("123456789")).toEqual({ input: "123456789", start: null });
  });
  it("points a URL target at a moment, and only a URL", () => {
    expect(withStartTime("https://www.twitch.tv/videos/123", 3723.4)).toBe(
      "https://www.twitch.tv/videos/123?t=1h2m3s",
    );
    expect(withStartTime("https://tracker.test/vod?id=7&t=1s", 60)).toBe(
      "https://tracker.test/vod?id=7&t=1m0s",
    );
    expect(withStartTime("123456789", 60)).toBeNull();
  });
});
