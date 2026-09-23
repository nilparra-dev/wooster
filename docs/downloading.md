# Downloading VODs

`download` saves the selected quality as a single file without external tools:

```bash
npx twitch-vod-m3u8@beta download 2434567890
npx twitch-vod-m3u8@beta download "video:xqc_51582913581_1721686515" -q 720p60 -o clip.ts
npx twitch-vod-m3u8@beta download 51582913581 --channel xqc
npx twitch-vod-m3u8@beta download 2434567890 --output-dir "D:\VODs"
npx twitch-vod-m3u8@beta list xqc --download 1
```

Segments are fetched in parallel and written in order, so an interrupted
download keeps a `.part` file and resumes when you run the same command again.
Some encoders leave frames with the MPEG-TS "no timestamp" sentinel, in the
PES header (PTS/DTS) or in the PCR; the downloader rewrites both in place,
because players such as VLC take the values literally and jump the media clock
to ~26.5 hours.
Output defaults to `downloads/<id>.ts` in the current directory; existing files
and partial downloads are never overwritten without `--force`. `-o` sets an
exact file path, while `--output-dir` sets only the folder and keeps the
generated name (`<id>.mp4` with `--remux`); the two options cannot be combined.
A file ending in `.mp4` or `--remux` converts to
MP4 with ffmpeg (`-c copy`, no re-encode, `+faststart`), checks the result
duration with ffprobe, and accepts `--ffmpeg-path <file>` or the
`TWITCH_VOD_M3U8_FFMPEG` environment variable; without ffmpeg the `.ts` file
plays in VLC, MPV and most editors. `--install-ffmpeg` downloads a pinned LGPL
static build from BtbN into `~/.cache/twitch-vod-m3u8/ffmpeg/`, verifies its
published SHA-256 and reuses it. macOS is not covered by the pinned matrix yet;
use Homebrew there or `--ffmpeg-path`.
`--engine auto` (default) keeps the requested container and only chooses how an
MP4 is built: hybrid by default, ffmpeg for fragmented or discontinued
playlists and when free disk space cannot hold the segment directory, and
native when a partial download can resume or `--keep-ts` is used. The decision
and its reason are printed to stderr and reported as `engineReason` in `--json`.
`--engine ffmpeg` skips the concatenation: ffmpeg downloads the validated
playlist directly and stream-copies it, which avoids the per-segment boundary
artifacts of the native engine. It downloads sequentially (slower) and cannot
resume.
`--engine hybrid` downloads the segments in parallel into `<output>.segments`
next to the output, then muxes them with ffmpeg. It keeps the native engine's
speed and per-segment resume, drops the concatenation artifacts, and removes
the segment directory only after publishing the final file; a failed run keeps
it and the next run reuses it. Every segment URL and redirect must stay on
Twitch's media domains, and an oversized segment aborts instead of filling the
disk.
