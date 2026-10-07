import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { choiceValue, integerValue, optionValue } from "../../dist/args.js";
import { exitCodeFor } from "../../dist/exit-codes.js";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

/**
 * Run the built CLI with a piped stdin, so no prompt is ever offered. Every case
 * below fails before the first network request; none of them needs Twitch.
 */
function run(...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", input: "", timeout: 20_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("cli entry point", () => {
  it("prints the package version and exits 0", () => {
    const result = run("--version");
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${version}\n`);
  });

  it("prints help, including the exit codes, and exits 0", () => {
    const result = run("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--verbose/);
    assert.match(result.stdout, /--timeout <seconds>/);
    assert.match(result.stdout, /Exit codes:/);
    assert.equal(result.stderr, "");
  });

  it("reports an unknown option as a usage error", () => {
    const result = run("--nope");
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Error: Unknown option: --nope\n");
  });

  it("reports unsupported input as a usage error", () => {
    const result = run("hello!");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^Error: Unsupported input\./);
  });

  it("writes the error as JSON on stdout when --json is present", () => {
    const result = run("hello!", "--json");
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "error");
    assert.equal(payload.error.code, "INVALID_INPUT");
    assert.match(payload.error.message, /^Unsupported input\./);
  });

  it("reports a JSON error in the same shape from every command", () => {
    for (const args of [["hello!"], ["list"], ["target"], ["live"], ["download", "hello!"], ["chat", "1"]]) {
      const result = run(...args, "--json");
      const payload = JSON.parse(result.stdout);
      assert.deepEqual(Object.keys(payload), ["status", "error"], args.join(" "));
      assert.equal(payload.status, "error", args.join(" "));
      assert.equal(typeof payload.error.code, "string", args.join(" "));
      assert.equal(typeof payload.error.message, "string", args.join(" "));
    }
  });

  it("accepts --timeout with the same range on every command", () => {
    for (const args of [
      ["2434567890"],
      ["download", "2434567890"],
      ["watch", "2434567890"],
      ["list", "xqc"],
      ["target", "xqc"],
      ["live", "xqc"],
      ["chat", "2434567890", "-o", "chat.json"],
    ]) {
      const result = run(...args, "--timeout", "0");
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /--timeout requires an integer between 1 and 300\./, args.join(" "));
    }
  });

  it("accepts --verbose on the commands that run the resolver", () => {
    // Each case stops at a later usage error, which proves the flag parsed.
    for (const args of [["download", "hello!"], ["watch", "live:xqc"], ["list"]]) {
      const result = run(...args, "--verbose");
      assert.equal(result.status, 2, args.join(" "));
      assert.doesNotMatch(result.stderr, /Unknown/, args.join(" "));
    }
  });

  it("asks for the channel of a hidden stream ID instead of guessing", () => {
    const result = run("51582913581", "--json");
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "CHANNEL_REQUIRED");
  });

  it("requires a value after an option that takes one", () => {
    const result = run("2434567890", "--quality", "--json");
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "INVALID_ARGUMENT");
  });

  it("validates the numeric options", () => {
    for (const args of [["--timeout", "0"], ["--timeout", "abc"], ["--timestamp-window", "901"]]) {
      const result = run("2434567890", ...args);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /requires an integer between/, args.join(" "));
    }
  });

  it("reports a missing input as a usage error when nothing can be prompted", () => {
    const result = run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^Error: Missing URL or ID\./);
  });

  it("gives every subcommand the same usage exit code", () => {
    for (const args of [["list"], ["target"], ["download"], ["download", "1", "--engine", "nope"], ["list", "xqc", "--limit", "0"]]) {
      assert.equal(run(...args).status, 2, args.join(" "));
    }
  });
});

describe("exit codes", () => {
  it("separates usage, not-found and network failures", () => {
    assert.equal(exitCodeFor("INVALID_ARGUMENT"), 2);
    assert.equal(exitCodeFor("CHANNEL_REQUIRED"), 2);
    assert.equal(exitCodeFor("NOT_FOUND"), 3);
    assert.equal(exitCodeFor("TIMESTAMP_UNAVAILABLE"), 3);
    assert.equal(exitCodeFor("OFFLINE"), 3);
    assert.equal(exitCodeFor("HTTP_ERROR"), 4);
    assert.equal(exitCodeFor("NETWORK_ERROR"), 4);
    assert.equal(exitCodeFor("CDN_UNREACHABLE"), 4);
  });

  it("keeps 1 for anything unclassified", () => {
    assert.equal(exitCodeFor(undefined), 1);
    assert.equal(exitCodeFor("ERROR"), 1);
    assert.equal(exitCodeFor("FFMPEG_FAILED"), 1);
  });
});

describe("argument value readers", () => {
  it("optionValue refuses a missing value and a following option", () => {
    assert.equal(optionValue(["-q", "720p60"], 0, "-q"), "720p60");
    assert.throws(() => optionValue(["-q"], 0, "-q"), { code: "INVALID_ARGUMENT", message: "-q requires a value." });
    assert.throws(() => optionValue(["-q", "--json"], 0, "-q"), { code: "INVALID_ARGUMENT" });
  });

  it("integerValue accepts only canonical integers inside the range", () => {
    assert.equal(integerValue(["--n", "5"], 0, "--n", 1, 10), 5);
    assert.equal(integerValue(["--n", "10"], 0, "--n", 1, 10), 10);
    for (const bad of ["0", "11", "08", "+5", "1e1", "5.5", "abc", ""]) {
      assert.throws(
        () => integerValue(["--n", bad], 0, "--n", 1, 10),
        { code: "INVALID_ARGUMENT", message: "--n requires an integer between 1 and 10." },
        bad,
      );
    }
    assert.throws(() => integerValue(["--n"], 0, "--n", 1, 10), { code: "INVALID_ARGUMENT" });
  });

  it("integerValue can phrase the expectation", () => {
    assert.throws(() => integerValue(["--t", "x"], 0, "--t", 1, 9, "start epoch seconds"), {
      message: "--t requires start epoch seconds.",
    });
  });

  it("choiceValue lists the alternatives in the error", () => {
    assert.equal(choiceValue(["--e", "hybrid"], 0, "--e", ["auto", "native", "hybrid"]), "hybrid");
    assert.throws(() => choiceValue(["--e", "x"], 0, "--e", ["auto", "native", "hybrid"]), {
      code: "INVALID_ARGUMENT",
      message: "--e must be auto, native or hybrid.",
    });
    assert.throws(() => choiceValue(["--e"], 0, "--e", ["auto"]), { message: "--e must be auto." });
  });
});
