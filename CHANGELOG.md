# Changelog

All notable changes to the `twitch-vod-m3u8` package are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/). While the version
is `0.x`, minor releases may break compatibility.

Entries up to `0.1.0-beta.4` were reconstructed from the git history and the
npm publish dates.

## [Unreleased]

### Added

- `live` resolves a channel that is broadcasting now; `live --watch` plays it
  in the local player with server-stitched ads removed.
- `download` saves a VOD as a single file with parallel, resumable segment
  downloads, `--output-dir`, and MP4 remux through ffmpeg.
- Download engines: `native`, `ffmpeg` and `hybrid`, chosen automatically by
  `--engine auto`, which reports its reason on stderr and in `--json`.
- `--install-ffmpeg` provisions a pinned, checksum-verified ffmpeg build.
- Probe results are cached per media URL within a process, and chat archives
  resume from a checkpoint.
- `--verbose` narrates the resolution on stderr: the step in progress, the
  serving hostname and, for a hidden VOD, the source and offset of the start
  time. The programmatic `resolveM3U8` gains a matching `onProgress` option.
- `--timeout <seconds>` sets the per-request timeout of the resolver. Every
  command accepts it with the same range, and `download`, `watch` and the row
  actions of `list` accept `--verbose` too.
- The CLI has documented exit codes: 2 for an invalid command line or input, 3
  when nothing is found and 4 when Twitch or a tracker cannot be reached.
- `npm run lint` runs ESLint over the CLI, and CI enforces it.
- A daily canary workflow resolves a real recent VOD, both by its public ID and
  by its rebuilt hidden path, and opens an issue when that stops working. It
  also requests every archive pinned for `--install-ffmpeg`.
- `watch` serves the player what a Twitch-like chat and timeline need, through
  local routes: emote, badge and channel images, the channel's badges, the
  BetterTTV, FrankerFaceZ and 7TV emote lists, and the broadcast's title,
  category, chapters and seek previews. For the third-party emotes it contacts
  those three services, which it did not before.

### Changed

- With `--json`, the resolver, `list`, `target` and `live` report a failure as
  `{ "status": "error", "error": { ... } }`, the shape `download` and `chat`
  already used. The `error` object is unchanged; `status` is new.
- The playback token request of public VODs and live channels is retried on a
  429 or 5xx answer like every other Twitch request, and a transport failure
  reports `NETWORK_ERROR` (exit code 4) instead of a generic failure.
- `watch` removes the chat journal from its cache once the chat is complete,
  which roughly halves the disk used by each cached chat.
- **Breaking:** a usage error now exits with 2, a missing VOD or channel with
  3, and a network failure with 4, where every failure used to exit with 1.
  Failures without a specific code still exit with 1, and Ctrl+C during
  `download` or `chat` still exits with 130.
- **Breaking:** invalid arguments report the `INVALID_ARGUMENT` code, in
  `--json` output too, where the top-level command and `live` used the generic
  `RESOLVE_FAILED` and `watch` used none. `--port` for `live` and `watch`
  now uses the same integer rule as the other numeric options.
- The three Twitch-owned VOD hostnames (`vod-secure`, `vod-metro`,
  `vod-pop-secure`) are probed only when no CloudFront hostname answers. They
  repeat the CloudFront content, so probing them together added a fifth of the
  requests of a timestamp window search for nothing. `VOD_DOMAINS` still lists
  all of them.

- The project is now called Wooster. The npm package keeps the name
  `twitch-vod-m3u8`.
- The player loads hls.js only when remote streaming starts and revalidates
  bundled assets with an ETag.
- The player caches the chat index in the browser, so reopening an archive does
  not rescan it.
- The session bridge reports the VOD offset a chat download has reached.

### Fixed

- Tracker sources that answer with a rate limit no longer look like an empty
  channel: `list` and `target` retry them honouring `Retry-After` and report a
  persistent failure as a warning instead of dropping the source silently.
- `list` and `target` ask TwiTracker's JSON API first and fall back to its HTML
  pages, so a throttled page no longer leaves rows without a stream ID or a
  start time. The list follows the API pagination, which gives `--limit` more
  rows with resolvable targets.
- A hidden VOD is no longer reported as deleted when Twitch's VOD servers were
  throttling or unreachable. If none of them gives a definitive answer the
  error is `CDN_UNREACHABLE` with exit code 4, where it used to be `NOT_FOUND`
  with exit code 3, and a `NOT_FOUND` after partial answers says how many
  requests went unanswered.
- Downloads repair unset MPEG-TS timestamps that made VLC jump to ~26.5 hours.
- `chat` and `watch` finish archiving a replay that Twitch only serves by time
  offset. Overlapping pages are deduplicated and put back in order, and the
  end of the replay is recognised, where the download used to stop as stalled
  or out of order and leave a partial archive.
- `watch` shows the chat saved so far, marked partial, when Twitch stops
  serving a replay midway, and the player states why chat is unavailable
  instead of folding the reason away.
- Download segment URLs and redirects must stay on Twitch's media domains.
- `download` warns about an output whose duration differs from the playlist
  even when stderr is not a terminal, so scripts and logs see it.
- The player keeps mute and volume across source changes.
- `watch` accepts a Twitch link that carries a `?t=` start time, which the
  resolver rejected as unsupported input.
- Playlists, tracker pages and Twitch API answers are read with an 8 MB limit,
  and a segment that declares no length is cut off at the segment limit
  instead of being buffered whole.

### Removed

- The Python pipeline and dashboard. The repository now contains only the CLI
  and the player.

## [0.1.0-beta.4] - 2026-09-10

### Added

- `chat` archives the available chat replay of a VOD to versioned JSON.
- `watch` streams a recovered VOD in a bundled local player with synchronized
  chat.
- `list` shows a channel's recent streams, hidden ones included, and `target`
  computes the canonical `video:...` target from exact tracker timestamps.
- The package exports a programmatic API.

## [0.1.0-beta.2] - 2026-09-04

### Fixed

- `--version` reports the package version.

## [0.1.0-beta.0] - 2026-09-04

### Added

- Resolve public and hidden Twitch VODs to playable M3U8 URLs from a VOD ID,
  tracker URL or canonical target.

[Unreleased]: https://github.com/nilparra-dev/wooster/compare/d5e7e09...HEAD
[0.1.0-beta.4]: https://www.npmjs.com/package/twitch-vod-m3u8/v/0.1.0-beta.4
[0.1.0-beta.2]: https://www.npmjs.com/package/twitch-vod-m3u8/v/0.1.0-beta.2
[0.1.0-beta.0]: https://www.npmjs.com/package/twitch-vod-m3u8/v/0.1.0-beta.0
