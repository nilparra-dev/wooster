# Programmatic use

The package can also be imported as an ES module:

```js
import { chooseFormat, resolveM3U8 } from "twitch-vod-m3u8";

const result = await resolveM3U8("https://twitchtracker.com/xqc/streams/51582913581");
const selected = chooseFormat(result.formats, "720p60");

console.log(selected.url);
```

Only the package entry point is supported. Deep imports into `dist/` can change
between releases.

## Functions

| Export | Purpose |
| --- | --- |
| `resolveM3U8(input, options?)` | Resolve any accepted target to its playable formats. |
| `resolveLiveM3U8(channel, options?)` | Resolve a channel that is live now. Returns the `live` result shape. |
| `chooseFormat(formats, quality?)` | Pick a format by its `id`; `"best"`, the default, is the first one. |
| `parseInput(input)` | Classify a target without any network request. |
| `parseLiveChannel(input)` | Normalize a login, a `live:` target or a channel URL to a login. |
| `buildFullVodPath(channel, streamId, timestamp)` | The hashed storage path of a hidden VOD. |
| `parseMasterManifest(text)` | Read the formats of a multivariant HLS playlist. |
| `VOD_DOMAINS` | The Twitch VOD hostnames the resolver probes and accepts. |

## Options

`resolveM3U8` and `resolveLiveM3U8` take the same optional object. The live
resolver uses `timeoutMs`, `signal` and `fetch`.

| Option | Meaning |
| --- | --- |
| `channel` | Channel of a bare hidden stream ID. |
| `timeoutMs` | Per-request timeout. Defaults to 12000. |
| `timestampWindow` | Seconds searched around an approximate start time. Defaults to 120; 0 disables the search. |
| `signal` | An `AbortSignal` that cancels the resolution. |
| `fetch` | A `fetch` implementation used for every request. |
| `onProgress` | Called with a short English sentence before each step that can take noticeable time. The text is for people; do not parse it. |

## Results

Every result has a `kind`, a `source` and `formats`, an array of
`{ id, url, height, fps }` with the best quality first.

| `kind` | Other fields |
| --- | --- |
| `public` | `videoId`, `masterUrl` |
| `live` | `channel`, `masterUrl` |
| `hidden` | `channel`, `streamId`, `startedAt` (ISO 8601), `canonicalTarget`, and optionally `vodId` and `timestamp` |

The `timestamp` report of a hidden result holds the `requested` and the `used`
start second, whether it was `adjusted`, and the `source` that supplied it:
`provided`, `twitracker`, `sullygnome`, `streamervitals` or `window`.

## Errors

A failed resolution rejects with a `ResolveError`, whose `code` says why:

| `code` | Meaning |
| --- | --- |
| `INVALID_INPUT` | The target is not a supported URL, ID or `video:` target. |
| `CHANNEL_REQUIRED` | A hidden stream ID was given without its channel. |
| `NOT_FOUND` | No media exists for the target, or Twitch returned no usable manifest. |
| `TIMESTAMP_UNAVAILABLE` | No source knows the start time of a hidden stream. |
| `ACCESS_DENIED` | Twitch did not grant playback access and no hidden path was found. |
| `QUALITY_UNAVAILABLE` | `chooseFormat` was asked for a quality the result does not have. |
| `OFFLINE` | The channel is not live, or Twitch refused live playback. |
| `HTTP_ERROR` | Twitch answered a request with an error status. |
| `NETWORK_ERROR` | Twitch could not be reached after the retries. |

Aborting through `signal` rejects with the signal's reason instead.
