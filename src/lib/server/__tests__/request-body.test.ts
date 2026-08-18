import { describe, expect, it, vi } from "vitest";
import { readBodyBytesWithByteCap } from "@/lib/server/request-body";

// The helper only touches request.body, so a minimal object with a body stream
// is enough to exercise it without standing up a full Request.
function requestWithBody(body: ReadableStream<Uint8Array> | null): Request {
	return { body } as unknown as Request;
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

const encoder = new TextEncoder();

describe("readBodyBytesWithByteCap", () => {
	it("returns an empty Uint8Array when there is no body", async () => {
		const result = await readBodyBytesWithByteCap(requestWithBody(null), 1024);
		expect(result).toEqual(new Uint8Array(0));
	});

	it("returns the raw bytes when they fit within the cap", async () => {
		const bytes = encoder.encode('{"hello":"world"}');
		const stream = streamOf([bytes]);

		const result = await readBodyBytesWithByteCap(
			requestWithBody(stream),
			1024,
		);
		expect(result).toEqual(bytes);
	});

	it("returns the bytes when exactly at the cap", async () => {
		const bytes = encoder.encode("abcde");
		const stream = streamOf([bytes]);

		const result = await readBodyBytesWithByteCap(requestWithBody(stream), 5);
		expect(result).toEqual(bytes);
	});

	it("returns null and stops reading once the cap is exceeded", async () => {
		const cancel = vi.fn().mockResolvedValue(undefined);
		const pulled: number[] = [];
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				// Two 4-byte chunks: the second pushes the total to 8, over the cap.
				pulled.push(pulled.length);
				controller.enqueue(encoder.encode("aaaa"));
				if (pulled.length >= 3) {
					controller.close();
				}
			},
			cancel,
		});

		const result = await readBodyBytesWithByteCap(requestWithBody(stream), 5);

		expect(result).toBeNull();
		expect(cancel).toHaveBeenCalledOnce();
		// The reader is cancelled at the over-cap chunk rather than draining the
		// whole stream, so we never buffer past the cap.
		expect(pulled.length).toBeLessThan(3);
	});

	it("joins bytes split across chunk boundaries without corruption", async () => {
		// Non-UTF-8 binary (a gzip-like byte sequence, including 0x00 and bytes
		// >0x7F) split mid-sequence — a per-chunk decode/re-encode would corrupt
		// this, so the join must operate on raw bytes only.
		const full = new Uint8Array([0x1f, 0x8b, 0x00, 0xff, 0x8b, 0x1f]);
		const splitPoint = 3;
		const stream = streamOf([
			full.slice(0, splitPoint),
			full.slice(splitPoint),
		]);

		const result = await readBodyBytesWithByteCap(
			requestWithBody(stream),
			1024,
		);
		expect(result).toEqual(full);
	});
});
