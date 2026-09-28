/**
 * Process exit codes, so a script can tell a mistake in its own command line
 * from a missing VOD and from a network problem without parsing messages.
 * `--json` errors carry the finer-grained `error.code` string.
 */
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_NETWORK = 4;
/** 128 + SIGINT, the shell convention for a process stopped with Ctrl+C. */
export const EXIT_INTERRUPTED = 130;

const USAGE_CODES: ReadonlySet<string> = new Set([
  "INVALID_ARGUMENT",
  "INVALID_INPUT",
  "INVALID_VOD_ID",
  "CHANNEL_REQUIRED",
  "LIVE_UNSUPPORTED",
]);

const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  "NOT_FOUND",
  "TIMESTAMP_UNAVAILABLE",
  "ACCESS_DENIED",
  "OFFLINE",
  "QUALITY_UNAVAILABLE",
  "CHAT_UNAVAILABLE",
]);

const NETWORK_CODES: ReadonlySet<string> = new Set(["HTTP_ERROR", "NETWORK_ERROR", "SEGMENT_HTTP_ERROR", "GRAPHQL_ERROR"]);

/** Exit code for an error `code`; anything unclassified is a generic failure. */
export function exitCodeFor(code: string | undefined): number {
  if (code === undefined) return EXIT_FAILURE;
  if (USAGE_CODES.has(code)) return EXIT_USAGE;
  if (NOT_FOUND_CODES.has(code)) return EXIT_NOT_FOUND;
  if (NETWORK_CODES.has(code)) return EXIT_NETWORK;
  return EXIT_FAILURE;
}
