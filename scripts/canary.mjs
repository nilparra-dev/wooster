// Live check of the assumptions the resolver cannot test with mocked requests:
// Twitch's GraphQL shape, the hidden-VOD path calculation, and that at least
// one known CDN hostname still stores the media. Run `npm run build` first.
//
// A channel that streams often keeps recent public VODs, and each public VOD
// carries the stream ID and start second needed to rebuild its hidden path, so
// no fixed VOD ID has to stay alive. Tracker lookups are reported but never
// fail the run: they sit behind Cloudflare, which may refuse CI addresses.
import { resolveM3U8 } from "../dist/resolver.js";
import { fetchChannelVideos, GqlClient } from "../dist/twitch/gql.js";
import { fetchTwitTrackerStreamTime } from "../dist/twitch/trackers.js";

const CHANNEL = process.env.CANARY_CHANNEL ?? "twitch";

function fail(message) {
  console.error(`CANARY FAILED: ${message}`);
  process.exit(1);
}

const videos = await fetchChannelVideos(new GqlClient({ attempts: 3 }), CHANNEL, { limit: 10 }).catch((error) =>
  fail(`Twitch's GraphQL listing for "${CHANNEL}" failed: ${error.message}`),
);
const video = videos.find((item) => item.streamId && item.startedAtSeconds);
if (!video) fail(`No recent public VOD of "${CHANNEL}" exposes a stream ID and start time.`);
console.log(`Using VOD ${video.vodId} (stream ${video.streamId}, started ${video.startedAtSeconds}).`);

const publicResult = await resolveM3U8(video.vodId).catch((error) => fail(`Public resolution failed: ${error.message}`));
if (publicResult.formats.length === 0) fail("The public manifest has no qualities.");
console.log(`Public VOD: ${publicResult.formats.length} qualities.`);

const target = `video:${CHANNEL}_${video.streamId}_${video.startedAtSeconds}`;
const hidden = await resolveM3U8(target, { timestampWindow: 0 }).catch((error) =>
  fail(`Hidden-path resolution of ${target} failed: ${error.message}`),
);
if (hidden.kind !== "hidden" || hidden.formats.length === 0) fail(`${target} did not resolve to media.`);
console.log(`Hidden path: ${hidden.formats.length} qualities on ${new URL(hidden.formats[0].url).hostname}.`);

const tracked = await fetchTwitTrackerStreamTime(CHANNEL, video.streamId).catch(() => null);
if (tracked === video.startedAtSeconds) console.log("TwiTracker agrees on the start time.");
else console.warn(`::warning::TwiTracker returned ${tracked ?? "nothing"} for the start time, expected ${video.startedAtSeconds}.`);
