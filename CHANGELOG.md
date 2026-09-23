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

### Changed

- The project is now called Wooster. The npm package keeps the name
  `twitch-vod-m3u8`.
- The player loads hls.js only when remote streaming starts and revalidates
  bundled assets with an ETag.
- The player caches the chat index in the browser, so reopening an archive does
  not rescan it.

### Fixed

- Downloads repair unset MPEG-TS timestamps that made VLC jump to ~26.5 hours.
- Download segment URLs and redirects must stay on Twitch's media domains.
- The player keeps mute and volume across source changes.

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
