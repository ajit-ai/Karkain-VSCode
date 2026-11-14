import * as assert from 'assert';
import {
  contentLengthBytes,
  extractFrames,
  frameMessage,
  repairServerMessageBody,
} from '../../jsonrpc-repair';

describe('jsonrpc-repair', () => {
  describe('repairServerMessageBody', () => {
    it('repairs the exact Karkain empty-envelope defect (shutdown)', () => {
      const r = repairServerMessageBody('{"jsonrpc":"2.0","id":6}');
      assert.strictEqual(r.outcome, 'repaired');
      assert.strictEqual(r.body, '{"jsonrpc":"2.0","id":6,"result":null}');
      assert.ok(r.note?.includes('id=6'));
    });

    it('repairs the empty envelope observed on hover with a string id', () => {
      const r = repairServerMessageBody('{"jsonrpc":"2.0","id":"abc-123"}');
      assert.strictEqual(r.outcome, 'repaired');
      assert.deepStrictEqual(JSON.parse(r.body), {
        jsonrpc: '2.0',
        id: 'abc-123',
        result: null,
      });
    });

    it('adds result when the envelope has no error, even with extra fields', () => {
      const r = repairServerMessageBody('{"jsonrpc":"2.0","id":1,"trace":"verbose"}');
      assert.strictEqual(r.outcome, 'repaired');
      assert.deepStrictEqual(JSON.parse(r.body), {
        jsonrpc: '2.0',
        id: 1,
        trace: 'verbose',
        result: null,
      });
    });

    it('leaves a valid result untouched (including falsy ones)', () => {
      for (const body of [
        '{"jsonrpc":"2.0","id":1,"result":false}',
        '{"jsonrpc":"2.0","id":1,"result":0}',
        '{"jsonrpc":"2.0","id":1,"result":""}',
        '{"jsonrpc":"2.0","id":1,"result":[]}',
        '{"jsonrpc":"2.0","id":1,"result":{}}',
      ]) {
        const r = repairServerMessageBody(body);
        assert.strictEqual(r.outcome, 'unchanged', body);
        assert.strictEqual(r.body, body);
      }
    });

    it('leaves an explicit null result untouched (the spec-conformant answer)', () => {
      const body = '{"jsonrpc":"2.0","id":2,"result":null}';
      const r = repairServerMessageBody(body);
      assert.strictEqual(r.outcome, 'unchanged');
      assert.strictEqual(r.body, body);
    });

    it('leaves a response that carries both result and error untouched', () => {
      const body = '{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":-1,"message":"x"}}';
      assert.strictEqual(repairServerMessageBody(body).outcome, 'unchanged');
    });

    it('leaves an error response untouched', () => {
      const body = '{"jsonrpc":"2.0","id":9,"error":{"code":-32602,"message":"invalid params"}}';
      const r = repairServerMessageBody(body);
      assert.strictEqual(r.outcome, 'unchanged');
      assert.strictEqual(r.body, body);
    });

    it('treats an explicit null error as absent (the server emits null only via omitempty)', () => {
      const r = repairServerMessageBody('{"jsonrpc":"2.0","id":4,"error":null}');
      assert.strictEqual(r.outcome, 'repaired');
      assert.deepStrictEqual(JSON.parse(r.body), { jsonrpc: '2.0', id: 4, result: null });
    });

    it('leaves notifications untouched', () => {
      const body =
        '{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///x"}}';
      const r = repairServerMessageBody(body);
      assert.strictEqual(r.outcome, 'unchanged');
      assert.strictEqual(r.body, body);
    });

    it('leaves server-initiated requests untouched (method + id)', () => {
      const body = '{"jsonrpc":"2.0","id":7,"method":"workspace/configuration"}';
      assert.strictEqual(repairServerMessageBody(body).outcome, 'unchanged');
    });

    it('leaves an envelope with a null id untouched', () => {
      const body = '{"jsonrpc":"2.0","id":null}';
      assert.strictEqual(repairServerMessageBody(body).outcome, 'unchanged');
    });

    it('leaves an envelope with no id untouched', () => {
      const body = '{"jsonrpc":"2.0"}';
      assert.strictEqual(repairServerMessageBody(body).outcome, 'unchanged');
    });

    it('passes unparseable bodies through verbatim', () => {
      const body = 'this is not json {{{';
      const r = repairServerMessageBody(body);
      assert.strictEqual(r.outcome, 'invalid-json');
      assert.strictEqual(r.body, body);
    });

    it('passes JSON arrays and scalars through verbatim', () => {
      for (const body of ['[1,2,3]', '42', '"just a string"', 'true', 'null']) {
        const r = repairServerMessageBody(body);
        assert.strictEqual(r.body, body, body);
      }
    });
  });

  describe('extractFrames', () => {
    it('extracts a single complete frame', () => {
      const buf = frameMessage('{"jsonrpc":"2.0","id":1,"result":null}');
      const { bodies, remaining, malformed } = extractFrames(buf);
      assert.strictEqual(malformed, false);
      assert.deepStrictEqual(bodies, ['{"jsonrpc":"2.0","id":1,"result":null}']);
      assert.strictEqual(remaining.length, 0);
    });

    it('extracts multiple frames from one chunk', () => {
      const buf = Buffer.concat([
        frameMessage('{"id":1}'),
        frameMessage('{"id":2}'),
        frameMessage('{"method":"textDocument/publishDiagnostics","params":{}}'),
      ]);
      const { bodies } = extractFrames(buf);
      assert.deepStrictEqual(bodies, [
        '{"id":1}',
        '{"id":2}',
        '{"method":"textDocument/publishDiagnostics","params":{}}',
      ]);
    });

    it('holds back an incomplete frame until the rest arrives', () => {
      const whole = frameMessage('{"jsonrpc":"2.0","id":42,"result":{"data":"x".repeat(100)}}');
      const first = whole.subarray(0, whole.length - 10);
      const a = extractFrames(first);
      assert.strictEqual(a.bodies.length, 0);
      assert.strictEqual(a.malformed, false);
      const b = extractFrames(Buffer.concat([a.remaining, whole.subarray(whole.length - 10)]));
      assert.deepStrictEqual(b.bodies, ['{"jsonrpc":"2.0","id":42,"result":{"data":"x".repeat(100)}}']);
    });

    it('handles multibyte bodies by byte length, not characters', () => {
      const body = '{"jsonrpc":"2.0","id":5,"result":"é—\u8d6e"}';
      const buf = frameMessage(body);
      const { bodies } = extractFrames(buf);
      assert.deepStrictEqual(bodies, [body]);
    });

    it('reports malformed when the Content-Length header is missing', () => {
      const buf = Buffer.from('Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}');
      const { malformed } = extractFrames(buf);
      assert.strictEqual(malformed, true);
    });

    it('tolerates a Content-Type header before Content-Length', () => {
      const body = '{"jsonrpc":"2.0","id":8,"result":null}';
      const framed = Buffer.concat([
        Buffer.from(
          `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n`,
        ),
        Buffer.from(body),
      ]);
      const { bodies, malformed } = extractFrames(framed);
      assert.strictEqual(malformed, false);
      assert.deepStrictEqual(bodies, [body]);
    });

    it('reports malformed when the body is absurdly large', () => {
      const buf = Buffer.from('Content-Length: 999999999999\r\n\r\n');
      const { malformed } = extractFrames(buf);
      assert.strictEqual(malformed, true);
    });

    it('computes Content-Length in bytes for multibyte content', () => {
      const body = '{"a":"é"}';
      assert.strictEqual(contentLengthBytes(body), Buffer.byteLength(body, 'utf8'));
      const frame = frameMessage(body);
      assert.ok(frame.includes(Buffer.from(`Content-Length: ${Buffer.byteLength(body, 'utf8')}`)));
    });
  });
});
