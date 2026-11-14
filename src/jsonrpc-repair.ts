// Pure JSON-RPC 2.0 message repair for the Karkain language-server wire
// protocol. Vscode-free so it stays unit-testable and reusable by the
// stdio proxy compiled to out/lsp-proxy.js.
//
// The Karkain LSP server (pkg/lsp) emits `{"jsonrpc":"2.0","id":N}` with
// NEITHER `result` NOR `error` whenever a handler produces no value, because
// its JSONRPCResponse.Result is `interface{}` tagged `omitempty` (see
// docs/KARKAIN-INSPECTION.md). vscode-jsonrpc classifies such a message as
// "neither a response nor a notification" and rejects the pending request
// with "The received response has neither a result nor an error property."
// Every unresolvable hover, definition or documentSymbol, and every shutdown,
// hits that path.
//
// The repair itself is minimal and deliberately mechanical: an envelope
// carrying a string|number `id`, no `method`, and neither `result` nor a
// non-null `error`, is given `"result": null` — exactly what the JSON-RPC 2.0
// spec and the LSP mandate (`result: null`). Nothing else is touched: valid
// responses, error responses, notifications, server-initiated requests and
// already-null results pass through byte-semantics unchanged. Unparseable
// bodies are passed through verbatim — inventing a response there would be
// worse than letting the client reject it honestly.

export type RepairOutcome = 'unchanged' | 'repaired' | 'invalid-json';

export interface RepairResult {
  outcome: RepairOutcome;
  /**
   * The body to forward. For 'unchanged' and 'invalid-json' this is the
   * original text (unmodified); for 'repaired' it is the re-serialized
   * envelope (compact).
   */
  body: string;
  /** Human-readable detail for the repair (outcome === 'repaired' only). */
  note?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Repairs one JSON-RPC body that came from the server.
 *
 * Cheap by construction: only JSON bodies that parse to a plain object are
 * inspected; everything else is returned as the caller received it.
 */
export function repairServerMessageBody(body: string): RepairResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { outcome: 'invalid-json', body };
  }
  if (!isPlainObject(parsed)) {
    // A JSON scalar or array is not a message we may touch.
    return { outcome: 'unchanged', body };
  }
  // A notification or a server-initiated request: never rewritten.
  if (typeof parsed['method'] === 'string') {
    return { outcome: 'unchanged', body };
  }
  const id = parsed['id'];
  if (typeof id !== 'string' && typeof id !== 'number') {
    // id null or missing: the envelope is ambiguous, leave it to the client.
    return { outcome: 'unchanged', body };
  }
  const hasResult = hasOwn(parsed, 'result');
  const error = parsed['error'];
  const hasUsableError = error !== undefined && error !== null;
  if (hasResult || hasUsableError) {
    return { outcome: 'unchanged', body };
  }
  // The observed server defect: `{"jsonrpc":"2.0","id":N}` where the handler
  // produced no result. The spec's answer is `"result": null`. A literal
  // `error: null` carries no information — it is the same defect wearing a
  // key — and leaving it would keep the envelope unclassifiable for the
  // client, so it is dropped alongside adding the null result.
  const repaired: Record<string, unknown> = { ...parsed, result: null };
  delete repaired['error'];
  return {
    outcome: 'repaired',
    body: JSON.stringify(repaired),
    note: `empty response envelope for id=${JSON.stringify(id)} (server omitted result and error)`,
  };
}

/** Byte length of a UTF-8 body — what Content-Length must announce. */
export function contentLengthBytes(body: string): number {
  return Buffer.byteLength(body, 'utf8');
}

/**
 * Serializes a repaired body into a Content-Length-framed wire message.
 * Kept here (not inline in the proxy) so framing is unit-tested against
 * multibyte bodies, where characters !== bytes.
 */
export function frameMessage(body: string): Buffer {
  const payload = Buffer.from(body, 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8'), payload]);
}

// ---- Content-Length frame extraction (server→proxy direction) ----

export interface ExtractedFrames {
  /** Complete message bodies found in `input`, in order. */
  bodies: string[];
  /** Bytes not yet a complete frame; feed back in with the next chunk. */
  remaining: Buffer;
  /**
   * True when a frame header is unparseable (garbage or absurd length).
   * The caller should switch to verbatim pass-through — a proxy that cannot
   * frame the stream is not entitled to guess at it; the client decides.
   */
  malformed: boolean;
}

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Extracts complete Content-Length frames from a byte buffer.
 * Tolerates header lines other than Content-Length (e.g. Content-Type) and
 * case-insensitive header names, mirroring what real servers emit.
 */
export function extractFrames(input: Buffer): ExtractedFrames {
  const bodies: string[] = [];
  let offset = 0;
  for (;;) {
    const rest = input.subarray(offset);
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      if (rest.length > MAX_HEADER_BYTES) {
        return { bodies, remaining: Buffer.alloc(0), malformed: true };
      }
      return { bodies, remaining: Buffer.from(rest), malformed: false };
    }
    const headerText = rest.subarray(0, headerEnd).toString('utf8');
    const match = /(?:^|\r?\n)[ \t]*Content-Length:[ \t]*(\d+)/i.exec(headerText);
    if (!match) {
      return { bodies, remaining: Buffer.alloc(0), malformed: true };
    }
    const length = Number.parseInt(match[1], 10);
    if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
      return { bodies, remaining: Buffer.alloc(0), malformed: true };
    }
    const bodyStart = offset + headerEnd + 4;
    if (input.length < bodyStart + length) {
      return { bodies, remaining: Buffer.from(input.subarray(offset)), malformed: false };
    }
    bodies.push(input.subarray(bodyStart, bodyStart + length).toString('utf8'));
    offset = bodyStart + length;
  }
}
