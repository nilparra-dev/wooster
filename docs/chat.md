# Chat archiving

The bundled chat downloader archives the chat replay independently of video
playback or downloads:

```bash
npx twitch-vod-m3u8@beta chat https://www.twitch.tv/videos/VOD_ID --output downloads/chat.json
```

For a hidden stream, pass a canonical target or tracker URL:

```bash
npx twitch-vod-m3u8@beta chat "video:CHANNEL_STREAM_ID_START_TIMESTAMP" --output downloads/chat.json
npx twitch-vod-m3u8@beta chat STREAM_ID --channel CHANNEL --output downloads/chat.json
```

From a source checkout, replace `npx twitch-vod-m3u8@beta` with
`node dist/cli.js` after `npm run build`.

This command archives chat independently of video playback or downloads. It
looks for an exact stream ID/channel match in accessible GraphQL VOD metadata,
also checking the start timestamp for canonical targets. Discovery checks up to
2,000 channel VODs. It does not guess a VOD based on a nearby date, and cannot
enumerate every hidden or deleted VOD. If discovery fails but you know the real
VOD ID, use `https://www.twitch.tv/videos/ID` explicitly. A stream ID is not a VOD
ID. The existing numeric-input heuristic treats IDs longer than ten digits as
stream IDs; a Twitch video URL always means a VOD ID.

The downloader refuses VODs that Twitch reports as recording or processing. If
metadata has disappeared, it still tries the chat endpoint using the known VOD
ID. A recoverable M3U8 does not imply recoverable chat, and an inaccessible chat
does not prevent using the existing video resolver.

Messages, user colors, badge IDs, emote fragments, deleted-user messages and
VOD-relative timestamps are retained. The [local player](player.md) can read these
exports. Emote image downloads are planned in
[the archive/player roadmap](internals/ARCHIVE_PLAYER_PLAN.md).
The JSON format is our versioned format, not a TwitchDownloader-compatible export.

Downloads save committed pages in `downloads/chat.json.archive/pages.jsonl` and
a bounded resume checkpoint in `checkpoint.json`. Repeat the same command and
output path after a network failure or Ctrl+C to resume; the checkpoint lets a
large archive continue without re-reading committed pages. The journal is
fsynced per page, while the checkpoint is rewritten periodically (every ten
pages or five seconds) and once more when the run stops; recovery reads the
pages committed after the checkpoint. Keep the `.archive`
directory until you have a finished JSON. A truncated final journal line is
discarded on recovery; corrupt committed pages cause an error. Messages are
streamed by page and only recent message IDs are kept for deduplication, so data
that repeats far in the past fails as out of order instead of being silently
merged. Existing output files are never overwritten.

The archive uses an exclusive lock to prevent concurrent writers. A lock left by
a crashed process is detected by PID and hostname and recovered automatically; a
lock from another host, or from a live process, still blocks. Atomic JSON
publication uses a hard link on the output filesystem when available, and falls
back to an exclusive copy on filesystems without hard-link support.

Twitch's internal API may reject cursor requests. In that case the downloader
queries the last saved second again, verifies overlap, and deduplicates message
IDs. It never advances by one second to escape a crowded page: an unresolvable
overlap or pagination loop leaves a partial archive instead of silently skipping
messages. A saved cursor may also expire; failures remain resumable but recovery
depends on Twitch still serving the necessary history.

`manifest.json` reports `partial`, `complete`, `empty`, `unavailable`, or `failed`.
`complete` means the end of the **available replay** was reached, not proof that
every original live message still exists. An empty API response is explicitly
reported as `empty`. Null responses and GraphQL errors are not treated as empty
chat. `--json` emits a structured result or error for automation; diagnostics go
to stderr in the normal mode. Failure exits with code 1; cancellation exits 130.
