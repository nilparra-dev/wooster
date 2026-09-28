import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchSullyGnomeStreamTime,
  fetchTwitTrackerStreamTime,
  fetchTwitTrackerStreams,
  parseCountText,
  parseDurationText,
  parseStreamerVitalsStreams,
  parseTwitTrackerApiStreams,
  parseTwitTrackerStreamTime,
  parseTwitTrackerStreams,
  TrackerError,
} from "../../dist/twitch/trackers.js";

const twitTrackerPage = `<table><tbody>
  <tr data-selected="false" role="button"><td><a href="/streamers/dralii/streams/321356041690"><time datetime="2026-09-10T00:21:47.000Z">Sep 10, 2026, 00:21</time></a></td><td>50m</td><td><a href="/streamers/dralii/streams/321356041690">in the US</a></td><td>Rocket League</td><td>EN</td><td>1,131</td><td>902</td><td>676</td><td>+65</td></tr>
</tbody></table>`;

const jsonResponse = (payload) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

const apiRow = (id, overrides = {}) => ({
  id,
  startedAt: "2026-09-10T00:21:47.000Z",
  endedAt: "2026-09-10T01:11:47.000Z",
  title: `stream ${id}`,
  gameName: "Rocket League",
  categorySlug: "rocket-league",
  language: "EN",
  peakViewers: 1131,
  origin: "archive",
  durationSec: 3000,
  avgViewers: 902,
  watchHours: 501,
  followersGained: 65,
  ...overrides,
});

/** The JSON table endpoint, as opposed to the HTML pages of the same host. */
const isApiTable = (url) => url.includes("/api/streamers/");
/** The JSON stream detail endpoint. */
const isApiStream = (url) => url.includes("/api/streams/");

describe("tracker parsers", () => {
  it("parses durations written in hours, minutes and seconds", () => {
    assert.equal(parseDurationText("2h 15m"), 8100);
    assert.equal(parseDurationText("50m"), 3000);
    assert.equal(parseDurationText("1h 2m 3s"), 3723);
    assert.equal(parseDurationText("45s"), 45);
    assert.equal(parseDurationText("—"), null);
    assert.equal(parseDurationText(""), null);
  });

  it("parses display counts with suffixes", () => {
    assert.equal(parseCountText("1,131"), 1131);
    assert.equal(parseCountText("3.1K"), 3100);
    assert.equal(parseCountText("2.4M"), 2_400_000);
    assert.equal(parseCountText("—"), null);
  });

  it("reads the exact start second from a twitracker stream page", () => {
    const html = `<nav><span class="sr-only">breadcrumb</span><time data-locale="en" data-title="false" datetime="2026-09-09T20:41:21.000Z">Sep 9, 2026, 20:41</time></span></nav>`;
    assert.equal(parseTwitTrackerStreamTime(html), 1788986481);
    assert.equal(parseTwitTrackerStreamTime("<html>no time</html>"), null);
  });

  it("parses the twitracker recent streams table", () => {
    const html = `<table><tbody>
      <tr data-selected="false" role="button"><td><a href="/streamers/dralii/streams/321356041690"><time datetime="2026-09-10T00:21:47.000Z">Sep 10, 2026, 00:21</time></a></td><td>50m</td><td><a href="/streamers/dralii/streams/321356041690">in the US (spotify ads)</a></td><td>Rocket League</td><td>EN</td><td>1,131</td><td>902</td><td>676</td><td>+65</td></tr>
      <tr data-selected="false" role="button"><td><a href="/streamers/dralii/streams/321352284122"><time datetime="2026-09-09T20:41:21.000Z">Sep 9, 2026, 20:41</time></a></td><td>2h 15m</td><td><a href="/streamers/dralii/streams/321352284122">giving opinion on pros = ban</a></td><td>Rocket League</td><td>EN</td><td>1,793</td><td>1,413</td><td>3.1K</td><td>+175</td></tr>
    </tbody></table>`;
    const streams = parseTwitTrackerStreams(html, "dralii");
    assert.equal(streams.length, 2);
    assert.deepEqual(streams[0], {
      source: "twitracker",
      channel: "dralii",
      streamId: "321356041690",
      internalId: null,
      startedAt: 1788999707,
      title: "in the US (spotify ads)",
      category: "Rocket League",
      durationSeconds: 3000,
      averageViewers: 902,
      peakViewers: 1131,
    });
    assert.equal(streams[1].streamId, "321352284122");
    assert.equal(streams[1].durationSeconds, 8100);
  });

  it("parses the streamervitals stream history table", () => {
    const html = `<table><tbody>
      <tr class="sv-row-link"><th scope="row" class="px-3"><a class="rounded" href="/dralii/stream/65335759"><time dateTime="2026-09-09T20:41:21.000Z">Sep 9, 2026, 8:41 PM UTC</time></a><span class="mt-0.5 block">giving opinion on pros = ban</span></th><td class="px-3">Rocket League</td><td class="px-3">2h 15m</td><td class="px-3">1,413</td><td class="px-3">1,793</td><td class="px-3">3.1K</td></tr>
    </tbody></table>`;
    const streams = parseStreamerVitalsStreams(html, "dralii");
    assert.equal(streams.length, 1);
    assert.deepEqual(streams[0], {
      source: "streamervitals",
      channel: "dralii",
      streamId: null,
      internalId: "65335759",
      startedAt: 1788986481,
      title: "giving opinion on pros = ban",
      category: "Rocket League",
      durationSeconds: 8100,
      averageViewers: 1413,
      peakViewers: 1793,
    });
  });

  it("parses a page of the twitracker JSON stream table", () => {
    const payload = {
      rows: [
        apiRow("321356041690"),
        apiRow("321352284122", { startedAt: "2026-09-09T20:41:21.000Z", title: "", durationSec: 8100 }),
      ],
      total: 50,
      pageSize: 15,
    };
    const streams = parseTwitTrackerApiStreams(payload, "dralii");
    assert.equal(streams.length, 2);
    assert.deepEqual(streams[0], {
      source: "twitracker",
      channel: "dralii",
      streamId: "321356041690",
      internalId: null,
      startedAt: 1788999707,
      title: "stream 321356041690",
      category: "Rocket League",
      durationSeconds: 3000,
      averageViewers: 902,
      peakViewers: 1131,
    });
    assert.equal(streams[1].title, null);
    assert.equal(streams[1].durationSeconds, 8100);
  });

  it("drops twitracker JSON rows that carry no usable stream ID or start", () => {
    const streams = parseTwitTrackerApiStreams(
      {
        rows: [
          { id: "live", startedAt: "2026-09-10T00:21:47.000Z" },
          { startedAt: "2026-09-10T00:21:47.000Z" },
          { id: "321356041690", startedAt: "yesterday" },
          apiRow("321356041690"),
        ],
      },
      "dralii",
    );
    assert.deepEqual(
      streams.map((stream) => stream.streamId),
      ["321356041690"],
    );
  });

  it("rejects a twitracker JSON answer that carries no stream list", () => {
    const rejected = (error) => error instanceof TrackerError && error.code === "INVALID_DATA";
    assert.throws(() => parseTwitTrackerApiStreams({ error: "busy" }, "dralii"), rejected);
    assert.throws(() => parseTwitTrackerApiStreams("<html>Server busy</html>", "dralii"), rejected);
    assert.throws(() => parseTwitTrackerApiStreams(null, "dralii"), rejected);
  });

  it("rejects twitracker JSON rows where no stream ID survived parsing", () => {
    assert.throws(
      () => parseTwitTrackerApiStreams({ rows: [{ id: "abc", startedAt: "2026-09-10T00:21:47.000Z" }] }, "dralii"),
      (error) => error instanceof TrackerError && error.code === "INVALID_DATA",
    );
  });
});

describe("tracker fetching", () => {
  it("serves the list from the twitracker JSON API without asking the page", async () => {
    const requested = [];
    const fetchImpl = async (input) => {
      const url = String(input);
      requested.push(url);
      if (!isApiTable(url)) throw new Error(`unexpected request: ${url}`);
      return jsonResponse({ rows: [apiRow("321356041690")], total: 50, pageSize: 15 });
    };
    const streams = await fetchTwitTrackerStreams("dralii", {
      fetch: fetchImpl,
      limit: 1,
      attempts: 3,
      retryDelayMs: 0,
    });
    assert.deepEqual(requested, ["https://twitracker.com/api/streamers/dralii/streams?page=1"]);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].streamId, "321356041690");
  });

  it("falls back to the channel page when the twitracker JSON API is throttled", async () => {
    let calls = 0;
    const fetchImpl = async (input) => {
      calls += 1;
      if (isApiTable(String(input))) return new Response("Server busy", { status: 503 });
      return new Response(twitTrackerPage, { status: 200 });
    };
    const streams = await fetchTwitTrackerStreams("dralii", { fetch: fetchImpl, attempts: 2, retryDelayMs: 0 });
    assert.equal(streams.length, 1);
    assert.equal(streams[0].streamId, "321356041690");
    assert.equal(calls, 3); // two attempts against the API, then the page
  });

  it("collects pages up to the requested limit", async () => {
    const pages = [
      { rows: [apiRow("100000000001"), apiRow("100000000002")], total: 4, pageSize: 15 },
      { rows: [apiRow("100000000003"), apiRow("100000000004")], total: 4, pageSize: 15 },
    ];
    let calls = 0;
    const fetchImpl = async (input) => {
      calls += 1;
      const page = Number(new URL(String(input)).searchParams.get("page"));
      return jsonResponse(pages[page - 1] ?? { rows: [], total: 0, pageSize: 15 });
    };
    const streams = await fetchTwitTrackerStreams("dralii", {
      fetch: fetchImpl,
      limit: 3,
      attempts: 1,
      retryDelayMs: 0,
    });
    assert.equal(calls, 2);
    assert.deepEqual(
      streams.map((stream) => stream.streamId),
      ["100000000001", "100000000002", "100000000003"],
    );
  });

  it("stops paging when the endpoint repeats rows it already served", async () => {
    const rows = [apiRow("100000000001"), apiRow("100000000002")];
    let calls = 0;
    const fetchImpl = async (input) => {
      calls += 1;
      if (!isApiTable(String(input))) throw new Error("the HTML page must not be requested here");
      return jsonResponse({ rows, total: rows.length, pageSize: 15 });
    };
    const streams = await fetchTwitTrackerStreams("dralii", {
      fetch: fetchImpl,
      limit: 40,
      attempts: 1,
      retryDelayMs: 0,
    });
    assert.equal(calls, 2);
    assert.equal(streams.length, 2);
  });

  it("keeps the rows already collected when a later page fails", async () => {
    let calls = 0;
    const fetchImpl = async (input) => {
      const url = String(input);
      calls += 1;
      if (!isApiTable(url)) return new Response(twitTrackerPage, { status: 200 });
      if (url.endsWith("page=1")) return jsonResponse({ rows: [apiRow("100000000001")], total: 4, pageSize: 15 });
      return new Response("Server busy", { status: 503 });
    };
    const streams = await fetchTwitTrackerStreams("dralii", {
      fetch: fetchImpl,
      limit: 4,
      attempts: 2,
      retryDelayMs: 0,
    });
    assert.deepEqual(
      streams.map((stream) => stream.streamId),
      ["100000000001"],
    );
    assert.equal(calls, 3); // the first page, then two attempts at the second
  });

  it("reports both twitracker endpoints when neither answers", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("Server busy", { status: 503 });
    };
    await assert.rejects(
      fetchTwitTrackerStreams("dralii", { fetch: fetchImpl, attempts: 3, retryDelayMs: 0 }),
      (error) =>
        error instanceof TrackerError &&
        error.code === "HTTP_ERROR" &&
        /API: Tracker returned HTTP 503 \(twitracker\.com, retried 2 times\)/.test(error.message) &&
        /page: Tracker returned HTTP 503 \(twitracker\.com, retried 2 times\)/.test(error.message),
    );
    assert.equal(calls, 6);
  });

  it("does not retry a final HTTP error", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("not found", { status: 404 });
    };
    await assert.rejects(
      fetchTwitTrackerStreams("dralii", { fetch: fetchImpl, attempts: 4, retryDelayMs: 0 }),
      (error) =>
        error instanceof TrackerError &&
        error.code === "HTTP_ERROR" &&
        /API: Tracker returned HTTP 404 \(twitracker\.com\)/.test(error.message) &&
        /page: Tracker returned HTTP 404 \(twitracker\.com\)/.test(error.message) &&
        !/retried/.test(error.message),
    );
    assert.equal(calls, 2); // one attempt per endpoint: a 404 is final
  });

  it("waits for the delay the tracker asks for", async () => {
    let calls = 0;
    const fetchImpl = async (input) => {
      calls += 1;
      if (isApiTable(String(input)) && calls === 1) {
        return new Response("Server busy", { status: 503, headers: { "retry-after": "1" } });
      }
      return jsonResponse({ rows: [apiRow("321356041690")], total: 50, pageSize: 15 });
    };
    const startedAt = Date.now();
    const streams = await fetchTwitTrackerStreams("dralii", {
      fetch: fetchImpl,
      limit: 1,
      attempts: 2,
      retryDelayMs: 0,
    });
    const waitedMs = Date.now() - startedAt;
    assert.equal(streams.length, 1);
    assert.equal(calls, 2);
    assert.ok(waitedMs >= 900, `expected to wait for Retry-After, waited ${waitedMs}ms`);
  });

  it("retries transport failures and reports them when they persist", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      throw new Error("socket hang up");
    };
    await assert.rejects(
      fetchTwitTrackerStreams("dralii", { fetch: fetchImpl, attempts: 2, retryDelayMs: 0 }),
      (error) =>
        error instanceof TrackerError &&
        error.code === "NETWORK_ERROR" &&
        /API: Tracker request failed: socket hang up/.test(error.message) &&
        /page: Tracker request failed: socket hang up/.test(error.message),
    );
    assert.equal(calls, 4);
  });

  it("reads the exact start second from the twitracker JSON stream detail", async () => {
    const exact = 1788986481;
    const requested = [];
    const fetchImpl = async (input) => {
      const url = String(input);
      requested.push(url);
      if (!isApiStream(url)) throw new Error(`unexpected request: ${url}`);
      return jsonResponse({
        stream: { id: "321356041690", login: "dralii", startedAt: new Date(exact * 1000).toISOString() },
      });
    };
    const startedAt = await fetchTwitTrackerStreamTime("dralii", "321356041690", {
      fetch: fetchImpl,
      attempts: 3,
      retryDelayMs: 0,
    });
    assert.equal(startedAt, exact);
    assert.deepEqual(requested, ["https://twitracker.com/api/streams/321356041690"]);
  });

  it("falls back to the stream page when the JSON API does not describe the stream", async () => {
    const exact = 1788986481;
    const fetchImpl = async (input) =>
      isApiStream(String(input))
        ? new Response("not found", { status: 404 })
        : new Response(`<time datetime="${new Date(exact * 1000).toISOString()}">x</time>`, { status: 200 });
    assert.equal(
      await fetchTwitTrackerStreamTime("dralii", "321356041690", { fetch: fetchImpl, attempts: 3, retryDelayMs: 0 }),
      exact,
    );
  });

  it("keeps a page answer without a start time as a null result", async () => {
    const fetchImpl = async (input) =>
      isApiStream(String(input))
        ? new Response("not found", { status: 404 })
        : new Response("<html>no time</html>", { status: 200 });
    assert.equal(
      await fetchTwitTrackerStreamTime("dralii", "321356041690", { fetch: fetchImpl, attempts: 3, retryDelayMs: 0 }),
      null,
    );
  });

  it("refuses a start time that belongs to another channel", async () => {
    const theirs = 1788980000;
    const mine = 1788986481;
    const fetchImpl = async (input) =>
      isApiStream(String(input))
        ? jsonResponse({ stream: { id: "321356041690", login: "xqc", startedAt: new Date(theirs * 1000).toISOString() } })
        : new Response(`<time datetime="${new Date(mine * 1000).toISOString()}">x</time>`, { status: 200 });
    assert.equal(
      await fetchTwitTrackerStreamTime("dralii", "321356041690", { fetch: fetchImpl, attempts: 3, retryDelayMs: 0 }),
      mine,
    );
  });

  it("keeps SullyGnome transport failures as a null result for its callers", async () => {
    const fetchImpl = async () => new Response("<html>Just a moment...</html>", { status: 403 });
    assert.equal(
      await fetchSullyGnomeStreamTime("dralii", "321356041690", { fetch: fetchImpl, attempts: 4, retryDelayMs: 0 }),
      null,
    );
  });
});
