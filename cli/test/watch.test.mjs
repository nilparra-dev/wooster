import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { allowedMediaUrl, fetchMedia } from "../../dist/net/media.js";
import { MediaRegistry, byteRange } from "../../dist/watch/media.js";
import {
  startWatchServer,
  readChunkWithIdleTimeout,
  withoutStartTime,
} from "../../dist/watch/server.js";

const media = "https://vod-secure.twitch.tv.invalid/file.m3u8";
const source = "https://video-weaver.test.ttvnw.net/archive/index.m3u8";
const result = (id = "123") => ({
  kind: "public",
  source: "twitch",
  videoId: id,
  masterUrl: source,
  formats: [{ id: "720p60", url: source, height: 720, fps: 60 }],
});
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "watch-test-"));
  await writeFile(
    join(directory, "replay.html"),
    "<!doctype html><title>Replay</title>",
  );
  await writeFile(join(directory, "chat.json"), '{"messages":[]}');
  const server = await startWatchServer({
    assets: directory,
    autoChat: false,
    resolver: async () => result(),
    ...options,
  });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...server, directory, api: new URL("api/", server.url).href };
}
async function ready(server) {
  for (let i = 0; i < 100; i++) {
    const state = await (await fetch(server.api + "session")).json();
    if (state.state === "ready") return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Session did not resolve");
}
test("media allowlist rejects arbitrary hosts, credentials, ports and schemes", () => {
  assert.equal(allowedMediaUrl(source).protocol, "https:");
  for (const url of [
    media,
    "http://127.0.0.1/secret",
    "file:///etc/passwd",
    "https://evil.test/a",
    "https://a.ttvnw.net.evil.test/a",
    "https://user:pass@a.ttvnw.net/a",
    "https://a.ttvnw.net:8080/a",
  ]) {
    assert.throws(() => allowedMediaUrl(url));
  }
});
test("playlist rewriting registers segments, keys, init maps and child playlists", () => {
  const registry = new MediaRegistry("/secret/");
  const rewritten = registry.rewrite(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\nchunk.ts?token=abc\n',
    source,
  );
  assert.ok(!rewritten.includes("token=abc"));
  assert.equal(registry.resources.size, 4);
  assert.equal(
    [...registry.resources.values()].filter((r) => r.manifest).length,
    1,
  );
  assert.ok(rewritten.includes('URI="/secret/media/'));
  assert.throws(() =>
    registry.rewrite("#EXTM3U\nhttp://127.0.0.1/admin", source),
  );
  assert.throws(() => registry.rewrite("<html>blocked</html>", source));
  const next = new MediaRegistry("/secret/");
  assert.notEqual(
    next.register(source),
    registry.register(source),
    "reconnect gets a new URL even for unsigned playlists",
  );
});
test("redirects are validated before following and Range is preserved", async () => {
  const calls = [];
  await assert.rejects(
    fetchMedia(source, {
      signal: new AbortController().signal,
      range: "bytes=1-3",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        });
      },
    }),
    /outside Twitch/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Range, "bytes=1-3");
  let count = 0;
  const response = await fetchMedia(source, {
    signal: new AbortController().signal,
    fetch: async () =>
      ++count === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "next.m3u8" },
          })
        : new Response("ok"),
  });
  assert.equal(await response.text(), "ok");
  assert.equal(count, 2);
});
test("missing unmuted segments fall back to the matching muted segment", async () => {
  const calls = [];
  const response = await fetchMedia(source.replace("index.m3u8", "0-unmuted.ts?token=abc"), {
    signal: new AbortController().signal,
    fetch: async url => { calls.push(url); return calls.length === 1 ? new Response(null, {status:403}) : new Response("muted-video"); },
  });
  assert.equal(await response.text(), "muted-video");
  assert.match(calls[1], /0-muted\.ts\?token=abc$/);
});
test("local byte ranges support suffix, open end, clamp and reject invalid requests", () => {
  assert.deepEqual(byteRange("bytes=3-5", 10), { start: 3, end: 5 });
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange("bytes=8-", 10), { start: 8, end: 9 });
  assert.deepEqual(byteRange("bytes=0-100", 10), { start: 0, end: 9 });
  assert.equal(byteRange(undefined, 10), null);
  for (const range of [
    "bytes=-",
    "bytes=-0",
    "bytes=11-",
    "bytes=4-2",
    "bytes=0-1,3-4",
  ])
    assert.throws(() => byteRange(range, 10));
});
test("server requires its capability path, expected Host and same-origin writes", async (t) => {
  const server = await fixture(t);
  assert.equal((await fetch(server.origin)).status, 404);
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal((await fetch(server.url + "missing.js")).status, 404);
  const wrongHost = await new Promise((resolve, reject) => {
    get(server.url, { headers: { Host: "evil.test" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(wrongHost, 403);
  assert.equal(
    (
      await fetch(server.api + "session", {
        headers: { Origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(server.api + "resolve", {
        method: "POST",
        body: '{"input":"123"}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(server.api + "resolve", {
        method: "POST",
        headers: { Origin: server.origin },
        body: "{",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(server.api + "resolve", {
        method: "POST",
        headers: { Origin: server.origin },
        body: JSON.stringify({ input: "" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(server.url + "media/https://evil.test")).status,
    404,
  );
  assert.equal(
    (
      await fetch(server.api + "resolve", {
        method: "POST",
        headers: { Origin: server.origin },
        body: JSON.stringify({ input: "123" }),
      })
    ).status,
    202,
  );
  assert.equal((await ready(server)).input, "123");
});
test("an idle media body aborts instead of hanging", async () => {
  const abort = new AbortController();
  const stream = new ReadableStream({
    start(controller) {
      abort.signal.addEventListener("abort", () =>
        controller.error(abort.signal.reason),
      );
    },
  });
  const reader = stream.getReader();
  await assert.rejects(readChunkWithIdleTimeout(reader, 10, abort));
  assert.equal(abort.signal.aborted, true);
});
test("maps malformed requests to 400 and blocks encoded traversal", async (t) => {
  const server = await fixture(t);
  for (const body of ["null", "[]", '{"input":123}', '{"input":["x"]}']) {
    const response = await fetch(server.api + "resolve", {
      method: "POST",
      headers: { Origin: server.origin },
      body,
    });
    assert.equal(response.status, 400, `body ${body} should be a client error`);
  }
  for (const route of ["%2e%2e%2fserver.js", "..%2fserver.js"]) {
    const response = await fetch(new URL(route, server.url));
    assert.equal(response.status, 404, `route ${route} should not escape the asset root`);
  }
  for (const route of ["%zz", "%E0%A4%A"]) {
    const response = await fetch(new URL(route, server.url));
    assert.equal(response.status, 400, `route ${route} should be a bad request`);
  }
  // A legitimate file whose name starts with dots must still be served.
  await writeFile(join(server.directory, "..config.txt"), "ok");
  const dots = await fetch(new URL("..config.txt", server.url));
  assert.equal(dots.status, 200);
  assert.equal(await dots.text(), "ok");
});
test("media proxy rewrites manifests and relays segment byte ranges", async (t) => {
  const calls = [];
  const server = await fixture(t, {
    input: "123",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return url.endsWith(".m3u8")
        ? new Response("#EXTM3U\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n")
        : new Response("abc", {
            status: 206,
            headers: {
              "content-range": "bytes 1-3/10",
              "content-length": "3",
              "content-type": "video/mp2t",
            },
          });
    },
  });
  const session = await ready(server);
  const playlist = await (
    await fetch(new URL(session.formats[0].url, server.origin))
  ).text();
  const segment = playlist.split("\n").find((line) => line.startsWith("/"));
  const response = await fetch(new URL(segment, server.origin), {
    headers: { Range: "bytes=1-3" },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 1-3/10");
  assert.equal(await response.text(), "abc");
  assert.equal(calls[1].init.headers.Range, "bytes=1-3");
});
test("stale resolver results cannot replace a newer broadcast", async (t) => {
  let finish;
  const server = await fixture(t, {
    input: "old",
    resolver: async (input) =>
      input === "old"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : result(input),
  });
  await fetch(server.api + "resolve", {
    method: "POST",
    headers: { Origin: server.origin },
    body: JSON.stringify({ input: "new" }),
  });
  await ready(server);
  finish(result("old"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const state = await (await fetch(server.api + "session")).json();
  assert.equal(state.input, "new");
  assert.equal(state.title, "Twitch VOD new");
});
test("explicit chat is served by revision and byte range independently of media", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "watch-chat-"));
  const chat = join(directory, "chat.json");
  await writeFile(chat, "0123456789");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await fixture(t, { input: "123", chatFile: chat });
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(server.api + "session")).json();
    if (state.chat.kind === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(state.chat.kind, "ready");
  const response = await fetch(new URL(state.chat.url, server.origin), {
    headers: { Range: "bytes=2-5" },
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "2345");
  assert.equal((await fetch(server.api + "chat?revision=999")).status, 404);
});
test("unavailable chat does not turn a playable video into an error", async (t) => {
  const server = await fixture(t, {
    input: "123",
    chatFile: join(tmpdir(), "missing-chat-for-watch-test.json"),
  });
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(server.api + "session")).json();
    if (state.chat.kind === "unavailable") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(state.state, "ready");
  assert.equal(state.chat.kind, "unavailable");
});
test("chat saved before Twitch stops serving the replay is shown as partial", async (t) => {
  const cache = await mkdtemp(join(tmpdir(), "watch-chat-cache-"));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const video = {
    id: "123", title: "Replay", createdAt: "2026-09-01T12:00:00Z", lengthSeconds: 100,
    status: "RECORDED", owner: { login: "some_channel" }, seekPreviewsURL: null,
  };
  const comment = {
    id: "m1", contentOffsetSeconds: 4, createdAt: "2026-09-01T12:00:04Z", commenter: null,
    message: { fragments: [{ text: "hi", emote: null }], userBadges: [], userColor: null },
  };
  const gql = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (!body.operationName)
      return new Response(JSON.stringify({ data: { video } }));
    if (body.variables.contentOffsetSeconds === 0)
      return new Response(JSON.stringify({ data: { video: { comments: {
        edges: [{ node: comment, cursor: "next" }], pageInfo: { hasNextPage: true },
      } } } }));
    return new Response("denied", { status: 403 });
  };
  const server = await fixture(t, { input: "123", autoChat: true, cache, fetch: gql });
  let state;
  for (let i = 0; i < 200; i++) {
    state = await (await fetch(server.api + "session")).json();
    if (state.chat.kind === "ready" || state.chat.kind === "unavailable") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(state.chat.kind, "ready");
  const chat = await (await fetch(new URL(state.chat.url, server.origin))).json();
  assert.equal(chat.status, "partial");
  assert.deepEqual(chat.messages.map((message) => message.id), ["m1"]);
});
test("player assets revalidate with an ETag while the session stays no-store", async (t) => {
  const server = await fixture(t);

  const asset = await fetch(`${server.url}replay.html`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("cache-control"), "private, no-cache");
  const etag = asset.headers.get("etag");
  assert.ok(etag);

  const revalidated = await fetch(`${server.url}replay.html`, {
    headers: { "if-none-match": etag },
  });
  assert.equal(revalidated.status, 304);
  assert.equal((await revalidated.text()).length, 0);

  const session = await fetch(server.api + "session");
  assert.equal(session.headers.get("cache-control"), "no-store");
});
test("a share link's start time is kept in the session but not sent to the resolver", async (t) => {
  const resolved = [];
  const server = await fixture(t, {
    input: "https://www.twitch.tv/videos/123?t=1h2m3s",
    resolver: async (input) => {
      resolved.push(input);
      return result();
    },
  });
  const session = await ready(server);
  assert.deepEqual(resolved, ["https://www.twitch.tv/videos/123"]);
  assert.equal(session.input, "https://www.twitch.tv/videos/123?t=1h2m3s");
  // Only a time is removed: other parameters and targets pass through untouched.
  for (const input of [
    "https://tracker.test/streams/1?t=token",
    "https://tracker.test/streams/1?t=",
    "video:channel_1_2",
    "123?t=5m",
  ])
    assert.equal(withoutStartTime(input), input);
  assert.equal(withoutStartTime("https://tracker.test/s?id=7&t=90"), "https://tracker.test/s?id=7");
});
test("chat images are proxied only from the Twitch CDN, by validated ID", async (t) => {
  const calls = [];
  const server = await fixture(t, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/emoticons/v2/404/default/dark/2.0")) return new Response("", { status: 404 });
      if (url.endsWith("/emoticons/v2/html/default/dark/2.0"))
        return new Response("<script>", { headers: { "content-type": "text/html" } });
      return new Response("png", { headers: { "content-type": "image/png" } });
    },
  });
  const emote = await fetch(server.api + "emote/emotesv2_abc123");
  assert.equal(emote.status, 200);
  assert.equal(emote.headers.get("content-type"), "image/png");
  assert.equal(emote.headers.get("cache-control"), "private, max-age=86400");
  assert.equal(await emote.text(), "png");
  assert.equal(
    calls[0].url,
    "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc123/default/dark/2.0",
  );
  assert.equal(calls[0].init.redirect, "error");

  const badge = await fetch(server.api + "badge/6ae7ce40-99e6-4d83-8487-f8b990bf5f32");
  assert.equal(badge.status, 200);
  assert.equal(
    calls[1].url,
    "https://static-cdn.jtvnw.net/badges/v1/6ae7ce40-99e6-4d83-8487-f8b990bf5f32/2",
  );

  // An ID from a chat archive must not reach another path or host.
  for (const id of ["..%2F..%2Fsecret", "a.b", "a%3Fb", "%40evil.test", "x".repeat(65)])
    assert.equal((await fetch(server.api + "emote/" + id)).status, 404, id);
  assert.equal((await fetch(server.api + "badge/not-a-uuid")).status, 404);
  assert.equal(calls.length, 2);

  assert.equal((await fetch(server.api + "emote/404")).status, 404);
  assert.equal((await fetch(server.api + "emote/html")).status, 502);
});
test("badges merge the channel set over the global one and drop foreign images", async (t) => {
  const image = (id) => `https://static-cdn.jtvnw.net/badges/v1/${id}/2`;
  const global = "11111111-1111-4111-8111-111111111111";
  const channel = "22222222-2222-4222-8222-222222222222";
  const requests = [];
  const server = await fixture(t, {
    input: "123",
    fetch: async (url, init) => {
      requests.push(JSON.parse(init.body));
      return Response.json({
        data: {
          badges: [
            { setID: "subscriber", version: "0", title: "Subscriber", imageURL: image(global) },
            { setID: "moderator", version: "1", title: "Moderator", imageURL: image(global) },
            { setID: "evil", version: "1", title: "Evil", imageURL: "https://evil.test/badge.png" },
          ],
          video: {
            owner: {
              broadcastBadges: [
                { setID: "subscriber", version: "0", title: "1-Month Sub", imageURL: image(channel) },
              ],
            },
          },
        },
      });
    },
  });
  const session = await ready(server);
  assert.equal((await fetch(server.api + "badges?revision=999")).status, 404);
  const response = await fetch(`${server.api}badges?revision=${session.revision}`);
  assert.equal(response.status, 200);
  const path = new URL("api/badge/", server.url).pathname;
  assert.deepEqual((await response.json()).badges, [
    { setId: "subscriber", version: "0", title: "1-Month Sub", url: path + channel },
    { setId: "moderator", version: "1", title: "Moderator", url: path + global },
  ]);
  assert.deepEqual(requests[0].variables, { id: "123" });
  // The lookup is shared: a second request does not query Twitch again.
  await fetch(`${server.api}badges?revision=${session.revision}`);
  assert.equal(requests.length, 1);
});
test("broadcast info carries the channel, chapters and proxied seek previews", async (t) => {
  const index = "https://d1m7jfoe9zdc1j.cloudfront.net/abc_chan_1_2/storyboards/123-info.json";
  const requests = [];
  const server = await fixture(t, {
    input: "123",
    fetch: async (url, init) => {
      requests.push(url);
      if (url === index)
        return Response.json([
          { quality: "low", count: 4, cols: 2, rows: 2, width: 160, height: 90, interval: 30, images: ["123-low-0.jpg"] },
          { quality: "high", count: 4, cols: 2, rows: 1, width: 220, height: 124, interval: 30, images: ["123-high-0.jpg", "123-high-1.jpg"] },
          { quality: "short", count: 9, cols: 2, rows: 2, width: 900, height: 500, interval: 30, images: ["x.jpg"] },
        ]);
      if (url.endsWith("123-high-1.jpg")) return new Response("jpeg", { headers: { "content-type": "image/jpeg" } });
      assert.deepEqual(JSON.parse(init.body).variables, { id: "123" });
      return Response.json({
        data: {
          video: {
            title: "Finale",
            createdAt: "2026-10-09T18:42:37Z",
            seekPreviewsURL: index,
            game: { displayName: "Just Chatting" },
            owner: {
              id: "71092938",
              login: "chan",
              displayName: "Chan",
              profileImageURL: "https://static-cdn.jtvnw.net/jtv_user_pictures/chan-profile_image-70x70.jpeg",
            },
            moments: {
              edges: [
                { node: { positionMilliseconds: 1364000, description: "Grand Theft Auto V" } },
                { node: { positionMilliseconds: 0, description: "Just Chatting" } },
                { node: { positionMilliseconds: -5, description: "Broken" } },
              ],
            },
          },
        },
      });
    },
  });
  const session = await ready(server);
  assert.equal((await fetch(server.api + "broadcast?revision=999")).status, 404);
  const info = await (await fetch(`${server.api}broadcast?revision=${session.revision}`)).json();
  const prefix = new URL(server.url).pathname;
  assert.deepEqual(
    { ...info, storyboard: { ...info.storyboard, images: info.storyboard.images.length } },
    {
      channel: { login: "chan", name: "Chan", avatar: `${prefix}api/avatar/chan-profile_image-70x70.jpeg` },
      title: "Finale",
      category: "Just Chatting",
      startedAt: "2026-10-09T18:42:37Z",
      chapters: [
        { start: 0, title: "Just Chatting" },
        { start: 1364, title: "Grand Theft Auto V" },
      ],
      // The sharpest set whose sheets hold every tile it announces.
      storyboard: { images: 2, interval: 30, count: 4, cols: 2, rows: 1, width: 220, height: 124 },
    },
  );
  const sheet = await fetch(new URL(info.storyboard.images[1], server.origin));
  assert.equal(await sheet.text(), "jpeg");
  assert.equal(requests.at(-1), "https://d1m7jfoe9zdc1j.cloudfront.net/abc_chan_1_2/storyboards/123-high-1.jpg");
});
test("seek previews outside Twitch's media servers are not proxied", async (t) => {
  const server = await fixture(t, {
    input: "123",
    fetch: async (url) => {
      assert.ok(url.startsWith("https://gql.twitch.tv/"), `unexpected request to ${url}`);
      return Response.json({
        data: { video: { title: "Finale", seekPreviewsURL: "https://evil.test/storyboards/1-info.json" } },
      });
    },
  });
  const session = await ready(server);
  const info = await (await fetch(`${server.api}broadcast?revision=${session.revision}`)).json();
  assert.equal(info.title, "Finale");
  assert.equal(info.channel, null);
  assert.equal(info.storyboard, null);
});
test("third-party emotes merge by precedence and survive one service failing", async (t) => {
  const requests = [];
  const bttv = (n) => String(n).padStart(24, "0");
  const lists = {
    "https://api.frankerfacez.com/v1/set/global": {
      default_sets: [3],
      sets: {
        3: { emoticons: [{ id: 1, name: "Shared" }, { id: 2, name: "FfzOnly" }] },
        9: { emoticons: [{ id: 3, name: "NotForEveryone" }] },
      },
    },
    "https://api.betterttv.net/3/cached/emotes/global": [
      { id: bttv(1), code: "Shared" },
      { id: "../../etc", code: "BadId" },
      { id: bttv(2), code: "has space" },
    ],
    "https://7tv.io/v3/emote-sets/global": { emotes: [{ id: "01G3WEGZN0000ET2J0MQP5YJ0G", name: "Shared" }] },
    "https://api.frankerfacez.com/v1/room/id/71092938": { sets: { 7: { emoticons: [{ id: 4, name: "Shared" }] } } },
    "https://7tv.io/v3/users/twitch/71092938": { emote_set: { emotes: [{ id: "01G3WEGZN0000ET2J0MQP5YJ0H", name: "ChannelOnly" }] } },
  };
  const server = await fixture(t, {
    input: "123",
    fetch: async (url) => {
      requests.push(url);
      if (url.startsWith("https://gql.twitch.tv/"))
        return Response.json({ data: { video: { owner: { id: "71092938", login: "chan" } } } });
      if (url === "https://api.betterttv.net/3/cached/users/twitch/71092938")
        return new Response("down", { status: 503 });
      if (url in lists) return Response.json(lists[url]);
      return new Response("png", { headers: { "content-type": "image/png" } });
    },
  });
  const session = await ready(server);
  const found = await (await fetch(`${server.api}emotes?revision=${session.revision}`)).json();
  const path = new URL("api/emote/", server.url).pathname;
  assert.deepEqual(Object.fromEntries(found.emotes.map((emote) => [emote.name, emote.url])), {
    // The channel's FrankerFaceZ emote beats every global one of that name.
    Shared: `${path}ffz/4`,
    FfzOnly: `${path}ffz/2`,
    ChannelOnly: `${path}7tv/01G3WEGZN0000ET2J0MQP5YJ0H`,
  });
  assert.deepEqual(found.failed, ["bttv"]);

  const before = requests.length;
  assert.equal((await fetch(server.api + "emote/7tv/01G3WEGZN0000ET2J0MQP5YJ0H")).status, 200);
  assert.equal(requests.at(-1), "https://cdn.7tv.app/emote/01G3WEGZN0000ET2J0MQP5YJ0H/2x.webp");
  assert.equal((await fetch(`${server.api}emote/bttv/${bttv(1)}`)).status, 200);
  assert.equal(requests.at(-1), `https://cdn.betterttv.net/emote/${bttv(1)}/2x`);
  assert.equal((await fetch(server.api + "avatar/chan-profile_image-70x70.jpeg")).status, 200);
  assert.equal(requests.at(-1), "https://static-cdn.jtvnw.net/jtv_user_pictures/chan-profile_image-70x70.jpeg");
  // IDs that do not have the provider's shape never leave the server.
  const sent = requests.length;
  for (const route of ["emote/bttv/short", "emote/ffz/12a", "emote/7tv/..%2Fx", "badge/ffz/1", "avatar/..%2Fsecret.png", "avatar/readme.txt"])
    assert.equal((await fetch(server.api + route)).status, 404, route);
  assert.equal(requests.length, sent);
  assert.equal(sent - before, 3);
});
test("a small FrankerFaceZ emote falls back to its base size", async (t) => {
  const requests = [];
  const server = await fixture(t, {
    fetch: async (url) => {
      requests.push(url);
      return url.endsWith("/2")
        ? new Response("", { status: 404 })
        : new Response("png", { headers: { "content-type": "image/png" } });
    },
  });
  assert.equal(await (await fetch(server.api + "emote/ffz/9")).text(), "png");
  assert.deepEqual(requests, [
    "https://cdn.frankerfacez.com/emote/9/2",
    "https://cdn.frankerfacez.com/emote/9/1",
  ]);
});
