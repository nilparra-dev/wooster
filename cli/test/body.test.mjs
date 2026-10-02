import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BodyTooLargeError, readBytesBody, readTextBody } from "../../dist/net/body.js";

/** A response that serves `chunks` one per read and counts how many were taken. */
function chunkedResponse(chunks) {
  const state = { served: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks[state.served];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      state.served += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body), state };
}

describe("bounded response readers", () => {
  it("reads a body that fits the limit", async () => {
    const { response } = chunkedResponse([new TextEncoder().encode("#EXTM3U\n"), new TextEncoder().encode("a.ts\n")]);
    assert.equal(await readTextBody(response, 64), "#EXTM3U\na.ts\n");
  });

  it("accepts a body of exactly the limit", async () => {
    const { response } = chunkedResponse([new Uint8Array(8)]);
    assert.equal((await readBytesBody(response, 8)).length, 8);
  });

  it("decodes a character split across two chunks", async () => {
    const bytes = new TextEncoder().encode("ñ");
    const { response } = chunkedResponse([bytes.subarray(0, 1), bytes.subarray(1)]);
    assert.equal(await readTextBody(response, 64), "ñ");
  });

  it("returns an empty result for a response without a body", async () => {
    assert.equal(await readTextBody(new Response(null, { status: 200 }), 64), "");
    assert.equal((await readBytesBody(new Response(null, { status: 200 }), 64)).length, 0);
  });

  it("stops reading once the limit is passed", async () => {
    const chunks = Array.from({ length: 64 }, () => new Uint8Array(1024));
    const { response, state } = chunkedResponse(chunks);
    await assert.rejects(readBytesBody(response, 2048), (error) => error instanceof BodyTooLargeError);
    // Three chunks prove the overflow; the stream may have one more queued.
    assert.ok(state.served <= 4, `served ${state.served} chunks`);
    assert.equal(state.cancelled, true);
  });
});
