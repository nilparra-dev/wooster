/**
 * Bounded response readers. `response.text()`, `json()` and `arrayBuffer()`
 * buffer whatever the server sends, so a wrong or hostile response can exhaust
 * memory. These read the stream and stop at a limit instead.
 */

/**
 * Limit for text the CLI parses in memory: playlists, tracker pages and
 * GraphQL answers. The longest VOD playlists are a few megabytes.
 */
export const MAX_TEXT_BODY_BYTES = 8 * 1024 * 1024;

/** A response body that was cut off because it passed the caller's limit. */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The response is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
    this.name = "BodyTooLargeError";
  }
}

async function readChunks(response: Response, maxBytes: number, onChunk: (chunk: Uint8Array) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new BodyTooLargeError(maxBytes);
      onChunk(chunk.value);
    }
  } finally {
    // Stops the transfer when the limit was hit; a no-op after a full read.
    await reader.cancel().catch(() => undefined);
  }
}

/** Read a body as UTF-8 text, failing with BodyTooLargeError past `maxBytes`. */
export async function readTextBody(response: Response, maxBytes = MAX_TEXT_BODY_BYTES): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  await readChunks(response, maxBytes, (chunk) => {
    text += decoder.decode(chunk, { stream: true });
  });
  return text + decoder.decode();
}

/** Read a body as bytes, failing with BodyTooLargeError past `maxBytes`. */
export async function readBytesBody(response: Response, maxBytes: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  await readChunks(response, maxBytes, (chunk) => chunks.push(chunk));
  return Buffer.concat(chunks);
}
