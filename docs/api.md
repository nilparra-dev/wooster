# Programmatic use

The package can also be imported as an ES module:

```js
import { chooseFormat, resolveM3U8 } from "twitch-vod-m3u8";

const result = await resolveM3U8("https://twitchtracker.com/xqc/streams/51582913581");
const selected = chooseFormat(result.formats, "720p60");

console.log(selected.url);
```

`parseInput`, `buildFullVodPath`, `parseMasterManifest`, `VOD_DOMAINS`,
`ResolveError` and the result types are exported too. `resolveLiveM3U8` resolves
a live channel to the same format shape. `resolveM3U8` accepts
`{ channel, timeoutMs, timestampWindow, signal, fetch }` as an optional second
argument. Hidden results include a `timestamp` report with the requested and
actually used second, whether it was corrected, and which source provided it.
`ResolveError.code` distinguishes `NOT_FOUND`, `TIMESTAMP_UNAVAILABLE`,
`CHANNEL_REQUIRED` and the other failure modes.
