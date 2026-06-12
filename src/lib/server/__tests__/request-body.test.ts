import { describe, expect, it, vi } from "vitest";
import { readBodyWithByteCap } from "@/lib/server/request-body";

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

describe("readBodyWithByteCap", () => {
	it("returns an empty string when there is no body", async () => {
		expect(await readBodyWithByteCap(requestWithBody(null), 1024)).toBe("");
	});

	it("returns the decoded body when it fits within the cap", async () => {
		const text = '{"hello":"world"}';
		const stream = streamOf([encoder.encode(text)]);

		expect(await readBodyWithByteCap(requestWithBody(stream), 1024)).toBe(text);
	});

	it("returns the body when it is exactly at the cap", async () => {
		const text = "abcde";
		const stream = streamOf([encoder.encode(text)]);

		expect(await readBodyWithByteCap(requestWithBody(stream), 5)).toBe(text);
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

		const result = await readBodyWithByteCap(requestWithBody(stream), 5);

		expect(result).toBeNull();
		expect(cancel).toHaveBeenCalledOnce();
		// The reader is cancelled at the over-cap chunk rather than draining the
		// whole stream, so we never buffer past the cap.
		expect(pulled.length).toBeLessThan(3);
	});

	it("decodes multi-byte UTF-8 sequences split across chunk boundaries", async () => {
		// "é" is 0xC3 0xA9; splitting it across two chunks would corrupt a
		// per-chunk decode but must survive the single trailing decode pass.
		const full = encoder.encode("café");
		const splitPoint = full.length - 1;
		const stream = streamOf([
			full.slice(0, splitPoint),
			full.slice(splitPoint),
		]);

		expect(await readBodyWithByteCap(requestWithBody(stream), 1024)).toBe(
			"café",
		);
	});
});
