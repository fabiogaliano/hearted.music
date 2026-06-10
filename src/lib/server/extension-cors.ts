/**
 * Only extension origins get CORS headers. The Bearer API token remains the
 * real auth gate; Origin is just the browser-enforced read gate.
 */
const DEFAULT_ALLOWED_HEADERS = "Authorization, Content-Type";

function isExtensionOrigin(origin: string | null): origin is string {
	return (
		typeof origin === "string" &&
		(origin.startsWith("chrome-extension://") ||
			origin.startsWith("moz-extension://"))
	);
}

function getCorsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get("Origin");

	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
		"Access-Control-Max-Age": "86400",
		Vary: "Origin, Access-Control-Request-Method",
	};

	if (isExtensionOrigin(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
		headers["Access-Control-Allow-Private-Network"] = "true";
	}

	return headers;
}

export function getExtensionCorsHeaders(
	request: Request,
): Record<string, string> {
	return getCorsHeaders(request);
}

export function extensionCorsPreflightResponse(request: Request): Response {
	return new Response(null, {
		status: 204,
		headers: getExtensionCorsHeaders(request),
	});
}
