# Command reference

Every example uses `npx twitch-vod-m3u8@beta`. From a source checkout, replace
it with `node dist/cli.js` after `npm run build`.

## CLI options

```text
-q, --quality <quality>      Select a quality; defaults to best
--channel <channel>          Channel for a hidden stream ID
--timestamp-window <secs>    Seconds searched around an approximate timestamp (default 120)
--all                        Print every available quality
--json                       Print structured JSON
--copy                       Copy the selected URL to the clipboard
--open [player]              Open VLC, MPV, IINA, or PotPlayer
-h, --help                   Show help
-v, --version                Show the version
```

The default output is a single URL, so it works well in scripts:

```bash
vlc "$(npx twitch-vod-m3u8@beta URL_OR_ID)"
```

Public Twitch manifest URLs contain short-lived playback credentials. Run the
resolver again if a public URL expires.

## Listing channel streams

`list` combines Twitch's public archive with tracker stream history that
includes the exact start second, so hidden or sub-only VODs are listed even
when Twitch does not show them:

```bash
npx twitch-vod-m3u8@beta list xqc
npx twitch-vod-m3u8@beta list xqc --probe
npx twitch-vod-m3u8@beta list xqc --target 1
npx twitch-vod-m3u8@beta list xqc --url 2 --quality 720p60
npx twitch-vod-m3u8@beta list xqc --watch 2
npx twitch-vod-m3u8@beta list xqc --limit 30 --json
```

Each row shows the start time in UTC, duration, stream ID, the sources that
found it, and the title. With a row number, `--target` prints the canonical
`video:...` target, `--url` prints the playable URL and `--watch` opens the
local player for that stream. The hidden target is computed automatically from
the exact stream ID and start second, so no manual timestamp is needed. `--all`
walks every public archive page. `--probe` checks media availability, reports
the serving domain and measures the exact media duration from the playlist;
without `--probe`, durations are tracker estimates. If a tracker or the Twitch
archive fails, the command prints the source error as a warning instead of
silently reporting "no streams".

Options:

```text
--limit <n>                 Rows to show (default 15, max 2000)
--all                       Walk every Twitch archive page
--probe                     Check media availability and show the domain
--target <n>                Print the canonical video: target for row n
--download <n>              Download stream n as a single file
--url <n>                   Print the playable URL for row n
--watch <n>                 Open the local player for row n
--no-open                   With --watch, do not open a browser
-q, --quality <quality>     Quality for --download/--url (default best)
--timestamp-window <secs>   Search window for approximate timestamps
--json                      Print structured JSON
```

### Canonical target

`target` computes the exact `video:channel_streamId_startTimestamp` target
without resolving media. It works even when Twitch does not list the VOD, as
long as a tracker knows the start second. `id` is an alias:

```bash
npx twitch-vod-m3u8@beta target xqc
npx twitch-vod-m3u8@beta target xqc STREAM_ID
npx twitch-vod-m3u8@beta target xqc STREAM_ID --timestamp 1788986481
```

Without a stream ID it uses the channel's most recent stream. The result can be
passed straight to the resolver, `watch`, or `--url`.

## Watching live channels

`live` resolves a channel that is broadcasting right now and either prints
its M3U8 URL or opens the local player with server-stitched ads removed:

```bash
npx twitch-vod-m3u8@beta live xqc
npx twitch-vod-m3u8@beta live https://www.twitch.tv/xqc --watch
npx twitch-vod-m3u8@beta live xqc --watch --with-ads
```

The printed raw URL is Twitch's own stream and still contains ads. Only the
local player (`--watch`) filters them: the bundled server drops ad-pod
segments from the proxied playlists and repairs the sequence counters before
they reach the browser, so playback continues without the pod. Segments that
do not carry an explicit ad marker are always kept, so an unrecognized pod
plays instead of stalling. When the playback token expires the server
re-resolves in the background and the player picks up the fresh source; use
Reconnect if it stalls. A channel that is offline reports `OFFLINE`. Live
chat is not supported yet; once the broadcast ends, its replay can be
archived with `chat` like any other VOD.
