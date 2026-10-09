import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { integerValue, optionValue, timeoutMsValue, verboseProgress } from "../args.js";
import { DEFAULT_TIMESTAMP_WINDOW, parseInput, ResolveError } from "../resolver.js";
import { startWatchServer, type ServerOptions } from "./server.js";

export async function watchCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout
      .write(`Watch a recovered Twitch VOD without downloading the video first.

Usage: twitch-m3u8 watch [URL|ID|video:...] [options]

  --channel CHANNEL   Channel for a hidden stream ID
  -q, --quality NAME  Initial quality (default: best)
  --chat FILE.json    Use an existing chat export instead of fetching replay
  --no-chat          Do not fetch chat automatically
  --no-open          Print the local URL without opening a browser
  --port NUMBER      Local port (default: a free port)
  --timestamp-window SECS  Seconds searched around an approximate timestamp
                           (default: ${DEFAULT_TIMESTAMP_WINDOW}; 0 disables)
  --timeout SECS     Per-request timeout while resolving, 1 to 300 (default: 12)
  --verbose          Explain each resolution step on stderr

Leave this process running while watching. Ctrl+C closes the local server.
Video is streamed from remaining Twitch CDN fragments. Deleted media cannot
be reconstructed, and chat availability is independent of video recovery.
`);
    return;
  }
  const options: ServerOptions = {
    assets: fileURLToPath(new URL("../player/", import.meta.url)),
  };
  let openBrowser = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--no-open") {
      openBrowser = false;
      continue;
    }
    if (arg === "--no-chat") {
      options.autoChat = false;
      continue;
    }
    if (arg === "--port") {
      options.port = integerValue(args, index, arg, 0, 65535);
      index += 1;
    } else if (arg === "--timestamp-window") {
      options.timestampWindow = integerValue(args, index, arg, 0, 900);
      index += 1;
    } else if (arg === "--timeout") {
      options.timeoutMs = timeoutMsValue(args, index, arg);
      index += 1;
    } else if (arg === "--verbose") {
      options.onProgress = verboseProgress;
    } else if (["--channel", "--quality", "-q", "--chat"].includes(arg)) {
      const value = optionValue(args, index, arg);
      index += 1;
      if (arg === "--channel") options.channel = value;
      else if (arg === "--chat") options.chatFile = value;
      else options.quality = value;
    } else if (arg.startsWith("-"))
      throw new ResolveError(`Unknown watch option: ${arg}`, "INVALID_ARGUMENT");
    else if (!options.input) options.input = arg;
    else throw new ResolveError(`Unexpected argument: ${arg}`, "INVALID_ARGUMENT");
  }
  if (options.input) {
    // Live channels have their own server mode with ad filtering and token
    // refresh. The VOD player would play them with ads and without refresh,
    // so redirect instead of silently degrading.
    let kind: string | null;
    try {
      kind = parseInput(options.input).kind;
    } catch {
      kind = null;
    }
    if (kind === "live") {
      throw new ResolveError(
        "That looks like a live channel. Use `twitch-m3u8 live <channel> --watch` for live playback with ad filtering.",
        "LIVE_UNSUPPORTED",
      );
    }
  }
  const server = await startWatchServer(options);
  process.stdout.write(`${server.url}\n`);
  process.stderr.write(
    "Local player is running. Keep this terminal open; Ctrl+C stops it.\n",
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (openBrowser) {
    const command =
      process.platform === "win32"
        ? "rundll32.exe"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    const parameters =
      process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", server.url]
        : [server.url];
    const child = spawn(command, parameters, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () =>
      process.stderr.write(
        "Could not open the browser automatically. Open the printed URL.\n",
      ),
    );
    child.unref();
  }
}
