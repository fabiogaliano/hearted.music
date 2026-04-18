/**
 * HMAC verification for billing-service → app bridge calls.
 *
 * Signature format: hex(HMAC-SHA256(secret, "{timestamp}.{hex(SHA256(body))}"))
 * Headers: X-Timestamp (Unix epoch seconds), X-Signature (hex string)
 * Clock skew window: 5 minutes (300 seconds).
 */

const CLOCK_SKEW_SECONDS = 300;

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	const encoder = new TextEncoder();
	const bufA = encoder.encode(a);
	const bufB = encoder.encode(b);
	let result = 0;
	for (let i = 0; i < bufA.length; i++) {
		result |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
	}
	return result === 0;
}

export type HmacVerificationResult =
	| { valid: true; body: string }
	| { valid: false; error: string };

/**
 * Verify HMAC signature on an incoming request.
 * Returns the raw body string on success for downstream JSON parsing.
 */
export async function verifyBridgeHmac(
	request: Request,
	secret: string,
): Promise<HmacVerificationResult> {
	const timestamp = request.headers.get("X-Timestamp");
	const signature = request.headers.get("X-Signature");

	if (!timestamp || !signature) {
		return { valid: false, error: "Missing authentication headers" };
	}

	const requestTime = Number(timestamp);
	if (Number.isNaN(requestTime)) {
		return { valid: false, error: "Invalid timestamp" };
	}

	const now = Date.now() / 1000;
	if (Math.abs(now - requestTime) > CLOCK_SKEW_SECONDS) {
		return { valid: false, error: "Request timestamp expired" };
	}

	const encoder = new TextEncoder();
	const body = await request.clone().text();
	const bodyHash = toHex(
		await crypto.subtle.digest("SHA-256", encoder.encode(body)),
	);

	const message = `${timestamp}.${bodyHash}`;
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const expected = toHex(
		await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
	);

	if (!timingSafeEqual(expected, signature)) {
		return { valid: false, error: "Invalid signature" };
	}

	return { valid: true, body };
}

/**
 * Sign a request body for testing or outbound calls.
 * Returns the timestamp and signature to set as headers.
 */
export async function signBridgeRequest(
	body: string,
	secret: string,
	timestampOverride?: number,
): Promise<{ timestamp: string; signature: string }> {
	const encoder = new TextEncoder();
	const timestamp = String(timestampOverride ?? Math.floor(Date.now() / 1000));
	const bodyHash = toHex(
		await crypto.subtle.digest("SHA-256", encoder.encode(body)),
	);

	const message = `${timestamp}.${bodyHash}`;
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = toHex(
		await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
	);

	return { timestamp, signature };
}
