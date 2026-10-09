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
playback. Completed chats are cached under `~/.cache/twitch-vod-m3u8/chat/`.
An interrupted download keeps its journal there and resumes the next time the
same VOD is opened; the journal is removed once the chat is complete. A failed
chat download does not stop the video: if Twitch stops serving the replay
midway, the messages saved so far are shown as a partial archive, and the
chat panel says why when there are none.
No full video is written to disk. Streaming still requires Internet access and
the CDN fragments to exist; it is not a permanent offline archive.

A Twitch link that carries a start time, such as
`https://www.twitch.tv/videos/ID?t=1h2m3s`, opens at that moment, both on the
command line and pasted into the player. The linked time takes precedence over
the saved position. Copy link at this time, below the video, writes such a link
for the current moment when the broadcast was opened from a URL.

The controls float over the video and hide after three seconds while it plays
untouched; moving the pointer, pressing a key or pausing brings them back, and
they stay while a menu is open or the keyboard focus is inside them. Choose
quality or change speed from the settings menu. When playback stops with
an error, Reconnect appears next to it and refreshes an expired source.
Quality changes and reconnection retain the saved playback position and keep a
playing video playing. The timeline shows the time under the pointer and, once
chat is loaded, where the conversation was busiest. When a
playlist references a missing `-unmuted.ts` segment, the server tries the matching
`-muted.ts` fragment. Missing fragments are reported; they are not silently skipped.

The server binds to `127.0.0.1`, uses a random session path, checks Host and Origin,
and only proxies registered Twitch media resources. It rewrites child playlists,
keys and initialization segments, validates redirects and supports byte ranges.
Media bodies stream with backpressure and cancellation; a stalled upstream is
aborted only when no data arrives, so slow segments are not cut off. Chat is read
by ranges. The browser receives local media URLs instead of Twitch playback
credentials.

Chat emotes and badges are images on Twitch's CDN, which the page's content
security policy does not let the browser load. The server proxies them from
`static-cdn.jtvnw.net` by ID: an emote ID from the archive or a badge UUID, both
validated, with no redirects, a 2 MB limit and an image content type required.
It asks Twitch once per broadcast for the global badges and the channel's own.
When an image cannot load the chat shows the emote's name, and the badge names
stay on the username's tooltip.

BetterTTV, FrankerFaceZ and 7TV emotes are drawn too. The server asks each
service for its global emotes and the channel's, by the channel's Twitch user
ID, and proxies the images from their CDNs under the same rules. A channel
emote wins over a global one of the same name, and between services 7TV wins
over BetterTTV over FrankerFaceZ. If one service is down the others still
load. These are the only requests the player makes outside Twitch.

The same lookup that finds the channel returns what Twitch knows about the
video: its title, category, date, chapters and seek previews. The player shows
them below the video, marks chapters on the timeline and previews the frame
under the pointer. A hidden VOD is no longer listed by Twitch, so it shows its
channel and date only, and previews only when its video ID is known.

To build an installable package, run `npm pack`. Its `prepack` step builds the CLI
and the standalone page. After installing that tarball, use `twitch-m3u8 watch`.
The published package includes the web assets and third-party license notices;
end users do not need the source checkout or frontend build tools. The player
shell imports hls.js only when remote streaming starts, so local file playback
does not download the library, and the bundled assets are revalidated with an
ETag inside a session.

Keyboard shortcuts work anywhere on the page: Space or `K` play/pause, the left
and right arrows or `J` and `L` seek 10 seconds, the up and down arrows change
the volume, `M` mutes, `F` toggles fullscreen and `Escape` exits theater mode.
Shortcuts are ignored while typing in an input. Space keeps activating a focused
button, and the up and down arrows keep scrolling the chat log when it has
focus. A click on the video plays or pauses it and a double click toggles
fullscreen. Actions taken from the keyboard or the video are confirmed briefly
on screen.

The player remembers volume, mute, speed, whether chat is shown and how wide,
and for each
video its position and chat offset. The start screen lists the broadcasts
recently opened through `watch` with how far each was watched; Clear empties
the list. All of this lives in the browser's storage for the page and is
optional: the player works the same when storage is blocked. The saved channel
option is not part of a recent entry, so a stream ID that needed `--channel`
has to be given it again.

## Local file mode

The player is also a standalone static page that needs no server beyond the one
serving the files:

```bash
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix frontend run preview -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/replay.html`. Choose a local video, then optionally
select the `chat.json` exported by the CLI, or drop either file or both onto the
page. Both files stay in your browser and
are never uploaded. The preview server must stay running to serve the player
assets.

The player supports browser-playable video files, such as H.264/AAC MP4 or WebM.
Remote HLS streaming uses the npm `watch` server described above. Local M3U8
files are not supported. Unsupported codecs are reported without discarding the
chat.

Chat follows the media clock during playback, pause, buffering, seeks and speed
changes. Click a message timestamp to seek, search messages or users across the
archive, or adjust the chat offset for trimmed videos, by typing it or one
second at a time. A positive offset shows later chat. In the search box,
`from:name` keeps one author's messages and any other words narrow them; a
click on a username fills that in and opens a card with their badges and how
many messages were found. A mouse resting on the chat holds it still, so a
name or a link can be clicked before it scrolls away, and following resumes
when the pointer leaves. While the chat follows the video, a message's time
appears when the message is hovered or focused; search results always show it. Theater mode supports Escape; the last playback position is restored
when the same video file is selected again, if browser storage is available.

The compact player has custom play/pause, volume, seek, settings, theater and
fullscreen controls. Chat stays inside a bounded panel as messages arrive, with
manual scroll and a banner that resumes following. Drag the chat's left edge to
resize it, or collapse it from its header. On mobile it moves below the video.
The browser regression checks this with 2,000 messages and long paragraphs.

The video and chat are paired explicitly by your file selection; the selected
chat's VOD ID and title are shown for verification. Changing video clears the chat
association. Missing, malformed or partial chat does not prevent video playback.
In this static mode there is no server to proxy images, so emotes are shown as
text, with badge names available on the username's tooltip. Offline image
caching and permanent offline video archiving remain future work.

Large chat JSON files are scanned in a Web Worker. The index stores byte ranges
and timestamps, not the complete message bodies. Playback reads at most 80
messages into the rendered window; scrolling back pauses following until you
select the Chat paused banner, and loads older messages 80 at a time up to 1,200 rendered
rows. Search scans the archive in order, with several range reads in flight, and
returns matches 100 at a time. The current limits are 4 GB per
file, two million messages and 1 MB per message or metadata block. Select the
final `.json` export, not the internal `pages.jsonl` journal. A damaged or
unsupported archive produces a visible error. Remote chat is read in aligned
4 MB blocks instead of one request per scan chunk, and the completed index is
cached in the browser, keyed by file identity, so reopening the same archive
does not rescan it.
