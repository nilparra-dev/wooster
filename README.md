<p align="center">
  <img src="https://raw.githubusercontent.com/nilparra-dev/wooster/main/frontend/public/favicon.svg" alt="Wooster logo" width="96" height="96" />
</p>

<h1 align="center">Wooster</h1>

<p align="center">
  Resolve public and hidden Twitch VODs, archive their chat, and watch them in a local player.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/twitch-vod-m3u8"><img src="https://img.shields.io/npm/v/twitch-vod-m3u8/beta?label=npm%40beta&color=101113" alt="npm beta version" /></a>
  <a href="https://github.com/nilparra-dev/wooster/actions/workflows/ci.yml"><img src="https://github.com/nilparra-dev/wooster/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <img src="https://img.shields.io/node/v/twitch-vod-m3u8/beta?color=101113" alt="Node.js version" />
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-101113" alt="No runtime dependencies" />
  <a href="https://github.com/nilparra-dev/wooster/blob/main/LICENSE"><img src="https://img.shields.io/github/license/nilparra-dev/wooster?color=101113" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="https://github.com/nilparra-dev/wooster/blob/main/CONTRIBUTING.md">Contributing</a>
</p>

---

Paste a VOD ID, a tracker URL or a canonical `video:...` target. Wooster finds
the available qualities and prints a playable M3U8 URL without downloading the
video.

- **Hidden VODs.** Recover sub-only, unlisted or hidden broadcasts from their
  stream ID and start time, using tracker history when Twitch no longer lists
  them.
- **Channel history.** List a channel's recent streams, hidden ones included,
  and open any of them by row number.
- **Local player.** Stream a recovered VOD in the browser with synchronized
  chat, without downloading the video or signing in.
- **Live channels.** Resolve a live broadcast, or watch it in the local player
  with server-stitched ads removed.
- **Downloads.** Save a VOD as a single `.ts` or `.mp4` file with parallel,
  resumable segment downloads.
- **Chat archiving.** Export the available chat replay to a versioned JSON
  archive that resumes after interruptions.

> [!NOTE]
> Wooster is in beta. Twitch and third-party tracker changes may break
> resolution without warning.

## Quick start

Requires Node.js 22 or newer. No installation is needed:

```bash
npx twitch-vod-m3u8@beta 2434567890
```

The package keeps the npm name
[`twitch-vod-m3u8`](https://www.npmjs.com/package/twitch-vod-m3u8), so every
command reads `npx twitch-vod-m3u8@beta`. The default output is a single URL,
so it composes with other tools:

```bash
vlc "$(npx twitch-vod-m3u8@beta URL_OR_ID)"
```

## Commands

| Command | What it does |
| --- | --- |
| `npx twitch-vod-m3u8@beta TARGET` | Print the playable M3U8 URL. Add `--all` for every quality or `--open vlc` to play it. |
| `npx twitch-vod-m3u8@beta list CHANNEL` | List recent streams, hidden ones included. `--watch 1` opens the first row. |
| `npx twitch-vod-m3u8@beta target CHANNEL` | Compute the canonical `video:...` target of the latest or a given stream. |
| `npx twitch-vod-m3u8@beta watch TARGET` | Open the local player with synchronized chat. |
| `npx twitch-vod-m3u8@beta live CHANNEL` | Resolve a live channel. `--watch` plays it without server-stitched ads. |
| `npx twitch-vod-m3u8@beta download TARGET` | Save the VOD as a single file, with resume and optional MP4 remux. |
| `npx twitch-vod-m3u8@beta chat TARGET --output chat.json` | Archive the available chat replay. |

`TARGET` accepts any of these:

- A numeric public Twitch VOD ID, or a `twitch.tv/videos/...` URL.
- A TwitchTracker, Streams Charts or SullyGnome stream URL.
- A canonical `video:channel_streamId_startTimestamp` target.
- A hidden stream ID together with `--channel CHANNEL`.

A hidden stream ID alone does not include its channel or exact start time.
Pass `--channel`, use a tracker URL, or provide the canonical target:

```bash
npx twitch-vod-m3u8@beta 51582913581 --channel xqc
npx twitch-vod-m3u8@beta "https://twitchtracker.com/xqc/streams/51582913581"
npx twitch-vod-m3u8@beta "video:xqc_51582913581_1721686515"
```

Run any command with `--help` for its options.

## Documentation

| Guide | Covers |
| --- | --- |
| [Command reference](https://github.com/nilparra-dev/wooster/blob/main/docs/cli.md) | Resolver options, `list`, `target` and `live` |
| [Downloading VODs](https://github.com/nilparra-dev/wooster/blob/main/docs/downloading.md) | Engines, resume, MP4 remux and ffmpeg provisioning |
| [Chat archiving](https://github.com/nilparra-dev/wooster/blob/main/docs/chat.md) | Discovery, resume, archive format and failure states |
| [Browser player](https://github.com/nilparra-dev/wooster/blob/main/docs/player.md) | `watch`, local file mode, shortcuts and limits |
| [Programmatic use](https://github.com/nilparra-dev/wooster/blob/main/docs/api.md) | The ES module API and its error codes |
| [Hidden VOD limits](https://github.com/nilparra-dev/wooster/blob/main/docs/hidden-vods.md) | When a hidden VOD cannot be recovered |
| [Security](https://github.com/nilparra-dev/wooster/blob/main/.github/SECURITY.md) | Network scope of the CLI and player, and how to report a vulnerability |

## Responsible use

Only access content you own or are authorized to view. You are responsible for
following Twitch's terms and the laws that apply to you.

## Contributing

Bug reports and pull requests are welcome. See
[CONTRIBUTING.md](https://github.com/nilparra-dev/wooster/blob/main/CONTRIBUTING.md)
for the development setup, checks and release process.

## License

[MIT](https://github.com/nilparra-dev/wooster/blob/main/LICENSE)
