# Browser player

The `watch` command bundles the player and its Node server in the npm package:

```bash
npx twitch-vod-m3u8@beta watch
npx twitch-vod-m3u8@beta watch "video:CHANNEL_STREAM_ID_START_TIMESTAMP"
```

The command opens a local web page. Paste a supported URL or target, or pass it
on the command line. Keep the terminal open while watching; Ctrl+C stops it.
Video loads from Twitch's remaining CDN fragments as needed. It does not require
a downloaded VOD, Python, FFmpeg, a dashboard account or a Twitch embed.

```bash
npx twitch-vod-m3u8@beta watch TARGET --quality 720p60
npx twitch-vod-m3u8@beta watch STREAM_ID --channel CHANNEL
npx twitch-vod-m3u8@beta watch TARGET --chat downloads/chat.json
npx twitch-vod-m3u8@beta watch TARGET --no-chat --no-open --port 5174
```

`--chat` explicitly pairs your export with the selected video. Otherwise the
launcher tries to recover chat using the exact VOD identity, independently of
playback. Completed chats and resumable journals are cached under
`~/.cache/twitch-vod-m3u8/chat/`. A failed chat download does not stop the video.
No full video is written to disk. Streaming still requires Internet access and
the CDN fragments to exist; it is not a permanent offline archive.

Choose quality, change speed or reconnect an expired source from the toolbar.
Quality changes and reconnection retain the saved playback position. When a
playlist references a missing `-unmuted.ts` segment, the server tries the matching
`-muted.ts` fragment. Missing fragments are reported; they are not silently skipped.

The server binds to `127.0.0.1`, uses a random session path, checks Host and Origin,
and only proxies registered Twitch media resources. It rewrites child playlists,
keys and initialization segments, validates redirects and supports byte ranges.
Media bodies stream with backpressure and cancellation; a stalled upstream is
aborted only when no data arrives, so slow segments are not cut off. Chat is read
by ranges. The browser receives local media URLs instead of Twitch playback
credentials.

To build an installable package, run `npm pack`. Its `prepack` step builds the CLI
and the standalone page. After installing that tarball, use `twitch-m3u8 watch`.
The published package includes the web assets and third-party license notices;
end users do not need the source checkout or frontend build tools. The player
shell imports hls.js only when remote streaming starts, so local file playback
does not download the library, and the bundled assets are revalidated with an
ETag inside a session.

Keyboard shortcuts work anywhere on the page: `K` play/pause, left and right
arrows seek 10 seconds, `M` mutes, `F` toggles fullscreen and `Escape` exits
theater mode. Shortcuts are ignored while typing in an input.

## Local file mode

The player is also a standalone static page that needs no server beyond the one
serving the files:

```bash
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix frontend run preview -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/replay.html`. Choose a local video, then optionally
select the `chat.json` exported by the CLI. Both files stay in your browser and
are never uploaded. The preview server must stay running to serve the player
assets.

The player supports browser-playable video files, such as H.264/AAC MP4 or WebM.
Remote HLS streaming uses the npm `watch` server described above. Local M3U8
files are not supported. Unsupported codecs are reported without discarding the
chat.

Chat follows the media clock during playback, pause, buffering, seeks and speed
changes. Click a message timestamp to seek, search messages or users across the
archive, or adjust the chat offset for trimmed videos. A positive offset shows
later chat. Theater mode supports Escape; the last playback position is restored
when the same video file is selected again, if browser storage is available.

The compact player has custom play/pause, volume, seek, speed, theater and
fullscreen controls. Chat stays inside a bounded panel as messages arrive, with
manual scroll and a Follow replay button. On mobile it moves below the video.
The browser regression checks this with 2,000 messages and long paragraphs.

The video and chat are paired explicitly by your file selection; the selected
chat's VOD ID and title are shown for verification. Changing video clears the chat
association. Missing, malformed or partial chat does not prevent video playback.
Emotes are currently shown as text, with badge names available on the username's
tooltip. Image caching and permanent offline video archiving remain future work.

Large chat JSON files are scanned in a Web Worker. The index stores byte ranges
and timestamps, not the complete message bodies. Playback reads at most 80
messages into the rendered window; scrolling back pauses following until you
select Follow replay. Search scans the archive in order, with several range reads
in flight, and returns the first 100 matches. The current limits are 4 GB per
file, two million messages and 1 MB per message or metadata block. Select the
final `.json` export, not the internal `pages.jsonl` journal. A damaged or
unsupported archive produces a visible error. Remote chat is read in aligned
4 MB blocks instead of one request per scan chunk, and the completed index is
cached in the browser, keyed by file identity, so reopening the same archive
does not rescan it.
