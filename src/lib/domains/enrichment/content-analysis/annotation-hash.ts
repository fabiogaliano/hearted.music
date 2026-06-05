// Stable content hash for the annotation-distillation cache.
//
// Identity is the TEXT only. The distiller version is the other half of the cache key
// (the (content_hash, distiller_version) primary key), so a text edit changes this hash
// and re-distills, while upgrading the distiller is keyed separately by version. Web Crypto
// keeps it Edge-compatible, matching the lyrics/embeddings hashing.

async function sha256Hex(content: string): Promise<string> {
	const data = new TextEncoder().encode(content);
	const buffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** `ad_<16 hex>` over the normalized annotation text. */
export async function hashAnnotationText(
	normalizedText: string,
): Promise<string> {
	const hex = await sha256Hex(normalizedText);
	return `ad_${hex.slice(0, 16)}`;
}
