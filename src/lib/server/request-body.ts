/**
 * Read a request body as text without ever buffering past a byte cap.
 *
 * On Cloudflare Workers the isolate has a hard 128 MB memory ceiling, and
 * `request.text()` / `request.json()` buffer the *entire* body before any size
 * check can run — a 40-100 MB payload plus its parsed object graph can blow that
 * budget and OOM the isolate (Error 1102). Measuring after the fact is too late;
 * the memory must be bounded *during* the read. This streams the body and aborts
 * the moment the running total exceeds `maxBytes`, so we never hold more than the
 * cap in memory.
 *
 * Returns the decoded body string, "" when there is no body, or `null` when the
 * stream exceeds `maxBytes` (the caller should answer 413).
 */
export async function readBodyWithByteCap(
	request: Request,
	maxBytes: number,
): Promise<string | null> {
	if (!request.body) {
		return "";
	}

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		total += value.byteLength;
		if (total > maxBytes) {
			// Stop pulling so we never buffer past the cap, then bail.
			await reader.cancel();
			return null;
		}

		chunks.push(value);
	}

	const buf = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		buf.set(chunk, offset);
		offset += chunk.byteLength;
	}

	// One decode pass over the joined bytes so multi-byte UTF-8 sequences split
	// across chunk boundaries decode correctly.
	return new TextDecoder().decode(buf);
}
