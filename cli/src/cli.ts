#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { stdin, stderr, stdout } from "node:process";

import { integerValue, optionValue, timeoutMsValue, verboseProgress } from "./args.js";
import { exitCodeFor } from "./exit-codes.js";
import type { ResolveResult } from "./types.js";
import { chooseFormat, DEFAULT_TIMESTAMP_WINDOW, parseInput, ResolveError, resolveM3U8 } from "./resolver.js";
import { copyToClipboard, openPlayer } from "./player-open.js";
import { chatCommand } from "./chat/command.js";
import { downloadCommand } from "./download/command.js";
import { listCommand } from "./list.js";
import { liveCommand } from "./live/command.js";
import { targetCommand } from "./target.js";
import { watchCommand } from "./watch/command.js";

function readPackageVersion(): string {
  const metadata: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof metadata === "object" && metadata !== null && "version" in metadata && typeof metadata.version === "string") {
    return metadata.version;
  }
  throw new Error("package.json does not contain a valid version");
}

const VERSION = readPackageVersion();
const PLAYERS = new Set(["vlc", "mpv", "iina", "potplayer"]);

interface CliOptions {
  input?: string;
  channel?: string;
  quality: string;
  all: boolean;
  json: boolean;
  copy: boolean;
  open: boolean;
  player?: string;
  timestampWindow: number;
  /** Per-request timeout; the resolver default applies when unset. */
  timeoutMs?: number;
  verbose: boolean;
  /** Set by --help and --version, which stop parsing and print instead of resolving. */
  info?: "help" | "version";
}

function help(): string {
  return `twitch-m3u8 ${VERSION}

Resolve public and hidden Twitch VODs to M3U8 URLs.

Usage:
  twitch-m3u8 <URL|ID|video:...> [options]
  twitch-m3u8 live <channel|URL> [--watch]
  twitch-m3u8 download <URL|ID|video:...> [-o file.ts]
  twitch-m3u8 target <channel> [stream-id]
  twitch-m3u8 list <channel> [--probe] [--target N | --download N | --url N | --watch N]
  twitch-m3u8 chat <URL|ID|video:...> --output <chat.json>
  twitch-m3u8 watch [URL|ID|video:...] [--channel CHANNEL]

Examples:
  twitch-m3u8 2434567890
  twitch-m3u8 live xqc --watch
  twitch-m3u8 51582913581 --channel xqc
  twitch-m3u8 "https://twitchtracker.com/xqc/streams/51582913581"
  twitch-m3u8 "video:xqc_51582913581_1721686515" --open vlc
  twitch-m3u8 download "video:xqc_51582913581_1721686515" -o clip.ts
  twitch-m3u8 target xqc
  twitch-m3u8 list xqc --probe

Options:
  -q, --quality <quality>      Select a quality; defaults to best
  --channel <channel>          Channel for a hidden stream ID
  --timestamp-window <secs>    Seconds searched around an approximate timestamp (default ${DEFAULT_TIMESTAMP_WINDOW})
  --timeout <seconds>          Per-request timeout, 1 to 300 (default 12)
  --verbose                    Explain each resolution step on stderr
  --all                        Print every available quality
  --json                       Print structured JSON
  --copy                       Copy the selected URL to the clipboard
  --open [player]              Open VLC, MPV, IINA, or PotPlayer
  -h, --help                   Show this help
  -v, --version                Show the version

Exit codes:
  0    Success
  1    Unexpected failure
  2    Invalid command line or input
  3    Nothing found: missing VOD, unavailable timestamp, offline channel
  4    Twitch or a tracker could not be reached
  130  Interrupted with Ctrl+C`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    quality: "best",
    all: false,
    json: false,
    copy: false,
    open: false,
    timestampWindow: DEFAULT_TIMESTAMP_WINDOW,
    verbose: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") return { ...options, info: "help" };
    if (arg === "-v" || arg === "--version") return { ...options, info: "version" };
    if (arg === "-q" || arg === "--quality") {
      options.quality = optionValue(args, index, arg);
      index += 1;
    } else if (arg === "--channel") {
      options.channel = optionValue(args, index, arg);
      index += 1;
    } else if (arg === "--timestamp-window") {
      options.timestampWindow = integerValue(args, index, arg, 0, 900);
      index += 1;
    } else if (arg === "--timeout") {
      options.timeoutMs = timeoutMsValue(args, index, arg);
      index += 1;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--copy") {
      options.copy = true;
    } else if (arg === "--open") {
      options.open = true;
      const possiblePlayer = args[index + 1]?.toLowerCase();
      if (possiblePlayer && PLAYERS.has(possiblePlayer)) {
        options.player = possiblePlayer;
        index += 1;
      }
    } else if (arg.startsWith("-")) {
      throw new ResolveError(`Unknown option: ${arg}`, "INVALID_ARGUMENT");
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new ResolveError(`Unexpected argument: ${arg}`, "INVALID_ARGUMENT");
    }
  }
  return options;
}

async function askInput(options: CliOptions): Promise<CliOptions> {
  if (options.input) return options;
  if (!stdin.isTTY) throw new ResolveError("Missing URL or ID. Run --help for examples.", "INVALID_ARGUMENT");
  const prompt = createInterface({ input: stdin, output: stderr });
  const input = (await prompt.question("Paste a URL, ID, or video:... target\n> ")).trim();
  prompt.close();
  if (!input) throw new ResolveError("No input was provided.", "INVALID_ARGUMENT");
  return { ...options, input };
}

async function askForMissingChannel(options: CliOptions): Promise<CliOptions> {
  if (!options.input || options.channel || parseInput(options.input).kind !== "stream-id" || !stdin.isTTY) {
    return options;
  }
  const prompt = createInterface({ input: stdin, output: stderr });
  const channel = (await prompt.question("Channel for this hidden stream:\n> ")).trim();
  prompt.close();
  if (!channel) throw new ResolveError("A channel is required to resolve a hidden stream ID.", "CHANNEL_REQUIRED");
  return { ...options, channel };
}

/** What `--verbose` reports once the resolver has an answer. */
function describeResult(result: ResolveResult): string[] {
  const lines = [`Resolved a ${result.kind === "live" ? "live stream" : `${result.kind} VOD`} with ${result.formats.length} qualities.`];
  const first = result.formats[0];
  if (first) lines.push(`Served from ${new URL(first.url).hostname}.`);
  if (result.kind === "hidden" && result.timestamp) {
    const { requested, used, adjusted, source } = result.timestamp;
    lines.push(
      adjusted && requested !== null
        ? `Start time ${used} from ${source}, ${Math.abs(used - requested)}s away from the requested ${requested}.`
        : `Start time ${used} from ${source}.`,
    );
  }
  return lines;
}

async function main(): Promise<void> {
  if (process.argv[2] === "live") {
    await liveCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "watch") {
    await watchCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "chat") {
    await chatCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "list") {
    await listCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "download") {
    await downloadCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "target" || process.argv[2] === "id") {
    await targetCommand(process.argv.slice(3));
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.info === "help") {
    stdout.write(`${help()}\n`);
    return;
  }
  if (parsed.info === "version") {
    stdout.write(`${VERSION}\n`);
    return;
  }
  const options = await askForMissingChannel(await askInput(parsed));
  if (!options.input) throw new ResolveError("Missing URL or ID.", "INVALID_ARGUMENT");

  if (stderr.isTTY || options.verbose) stderr.write("Searching Twitch playlists...\n");
  const result = await resolveM3U8(options.input, {
    timestampWindow: options.timestampWindow,
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.verbose ? { onProgress: verboseProgress } : {}),
  });
  if (options.verbose) for (const line of describeResult(result)) stderr.write(`${line}\n`);
  if (result.kind === "live" && stderr.isTTY) {
    // The generic resolver accepts live: targets and channel URLs for
    // scripting, but the raw URL still carries server-stitched ads.
    stderr.write("Note: this is a live edge URL and still contains ads. Use `live <channel> --watch` for the ad-filtered player.\n");
  }
  const selected = chooseFormat(result.formats, options.quality);

  if (options.json) {
    stdout.write(`${JSON.stringify({ ...result, selected }, null, 2)}\n`);
  } else if (options.all) {
    stdout.write(`${result.formats.map((format) => `${format.id}\t${format.url}`).join("\n")}\n`);
  } else {
    stdout.write(`${selected.url}\n`);
  }

  if (options.copy) {
    copyToClipboard(selected.url);
    if (stderr.isTTY) stderr.write("URL copied.\n");
  }
  if (options.open) {
    await openPlayer(selected.url, options.player);
    if (stderr.isTTY) stderr.write("Player opened.\n");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof ResolveError ? error.code : "ERROR";
  if (process.argv.includes("--json")) {
    stdout.write(`${JSON.stringify({ status: "error", error: { code, message } })}\n`);
  } else {
    stderr.write(`Error: ${message}\n`);
  }
  process.exitCode = exitCodeFor(code);
});
