/**
 * Uploads the sync payload as raw gzip bytes instead of plain JSON. Real
 * libraries can produce a JSON body north of the backend's 20 MB cap — gzip
 * typically shrinks JSON ~10x, keeping the wire payload under the cap without
 * the extension needing to chunk the upload.
 *
 * Content-Encoding is deliberately NOT set: Cloudflare's front line
 * auto-decompresses bodies that declare it, which would corrupt this scheme
 * since the backend route stages the bytes as-is (see
 * src/routes/api/extension/sync.tsx). Content-Type: application/gzip is how
 * the route distinguishes this path from the legacy plain-JSON one.
 *
 * Kept separate from service-worker.ts (which pulls in browser.* listeners at
 * module scope) so this wire-format logic can be unit tested in isolation.
 */
export async function postSyncPayload(
	apiToken: string,
	backendUrl: string,
	body: Record<string, unknown>,
): Promise<Response> {
	const json = JSON.stringify(body);
	const compressed = await new Response(
		new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
	).blob();
	return fetch(new URL("/api/extension/sync", `${backendUrl}/`).toString(), {
		method: "POST",
		headers: {
			"Content-Type": "application/gzip",
			Authorization: `Bearer ${apiToken}`,
		},
		body: compressed,
	});
}
