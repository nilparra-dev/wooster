// Live check that every archive pinned for `--install-ffmpeg` is still
// published. BtbN deletes builds on a schedule, and the test suite provisions
// from a local server, so only a real request notices a pin that expired.
// Run `npm run build` first.
import { pinnedReleases } from "../dist/download/provision.js";

let failed = false;
for (const release of pinnedReleases()) {
  // The release asset redirects to storage; following it proves the file is
  // there without downloading it.
  const status = await fetch(release.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) }).then(
    (response) => `HTTP ${response.status}`,
    (error) => error.message,
  );
  if (status === "HTTP 200") {
    console.log(`${release.id}: available.`);
  } else {
    failed = true;
    console.error(`CANARY FAILED: ${release.id} answered ${status} at ${release.url}`);
  }
}
if (failed) process.exit(1);
