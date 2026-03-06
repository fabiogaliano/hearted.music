/**
 * Any chrome-extension:// origin is accepted because the Bearer API token
 * is the actual auth gate — the origin is just an extra signal, not a secret.
 * Reflecting the exact origin (instead of *) is required by browsers when
 * credentials (Authorization header) are present.
 */
const DEFAULT_ALLOWED_HEADERS = "Authorization, Content-Type";

function getCorsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get("Origin");
	const requestedHeaders = request.headers.get(
		"Access-Control-Request-Headers",
	);

	const isExtensionOrigin =
		origin?.startsWith("chrome-extension://") ||
		origin?.startsWith("moz-extension://");

	const allowOrigin = isExtensionOrigin && origin ? origin : "*";

	return {
		"Access-Control-Allow-Origin": allowOrigin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": requestedHeaders ?? DEFAULT_ALLOWED_HEADERS,
		"Access-Control-Allow-Private-Network": "true",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
	};
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
