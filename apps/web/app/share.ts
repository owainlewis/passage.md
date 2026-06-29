// Anonymous share links carry the document inside the URL fragment (after `#`).
// The fragment never reaches a server, so a local draft can be shared with zero
// backend. Signed-in saved docs use the Go API's server-backed share routes.
//
// The payload is deflate-compressed before base64url encoding, which keeps the
// link far shorter than raw text for real Markdown.

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function streamBytes(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    }
  });
}

export async function encodeDoc(markdown: string): Promise<string> {
  const data = new TextEncoder().encode(markdown);
  const stream = streamBytes(data).pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return toBase64Url(compressed);
}

export async function decodeDoc(encoded: string): Promise<string> {
  const bytes = fromBase64Url(encoded);
  const stream = streamBytes(bytes).pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
