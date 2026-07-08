import { env } from "@/env";
import type { EventTokenClaims } from "./contract";

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array | string): string {
	const buf =
		typeof buffer === "string"
			? new TextEncoder().encode(buffer)
			: new Uint8Array(buffer);
	let binary = "";
	const len = buf.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(buf[i]);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(str: string): Uint8Array {
	const b64 =
		str.replace(/-/g, "+").replace(/_/g, "/") +
		"===".slice((str.length + 3) % 4);
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

const encoder = new TextEncoder();

async function getCryptoKey(secret: string) {
	return await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export async function signEventToken(
	claims: EventTokenClaims,
	secret = env.ACCOUNT_EVENTS_TOKEN_SECRET,
): Promise<string> {
	const header = { alg: "HS256", typ: "JWT" };
	const headerB64 = base64UrlEncode(JSON.stringify(header));
	const payloadB64 = base64UrlEncode(JSON.stringify(claims));

	const dataToSign = `${headerB64}.${payloadB64}`;
	const key = await getCryptoKey(secret);
	const signatureBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(dataToSign),
	);
	const signatureB64 = base64UrlEncode(signatureBuffer);

	return `${dataToSign}.${signatureB64}`;
}

export async function verifyEventToken(
	token: string,
	secret = env.ACCOUNT_EVENTS_TOKEN_SECRET,
): Promise<EventTokenClaims | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [headerB64, payloadB64, signatureB64] = parts;
	const dataToVerify = `${headerB64}.${payloadB64}`;
	let signatureBuffer: Uint8Array;
	try {
		signatureBuffer = base64UrlDecode(signatureB64);
	} catch {
		return null;
	}

	const key = await getCryptoKey(secret);
	const isValid = await crypto.subtle.verify(
		"HMAC",
		key,
		signatureBuffer.buffer as ArrayBuffer,
		encoder.encode(dataToVerify),
	);

	if (!isValid) return null;

	try {
		const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
		const claims = JSON.parse(payloadStr) as EventTokenClaims;

		// Check expiry locally
		if (claims.exp * 1000 < Date.now()) return null;

		return claims;
	} catch {
		return null;
	}
}
