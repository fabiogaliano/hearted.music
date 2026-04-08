import { createMiddleware, createStart } from "@tanstack/react-start";
import {
	getResponseHeaders,
	setResponseHeaders,
} from "@tanstack/react-start/server";

const securityHeadersMiddleware = createMiddleware().server(
	async ({ next }) => {
		const nonce = crypto.randomUUID();
		const isDev = import.meta.env.DEV;

		const headers = getResponseHeaders();

		if (!isDev) {
			const csp = [
				"default-src 'self'",
				"base-uri 'self'",
				"form-action 'self'",
				"frame-ancestors 'none'",
				`script-src 'strict-dynamic' 'nonce-${nonce}'`,
				// React inline style props require 'unsafe-inline'; nonces don't apply to style attributes
				`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
				"font-src 'self' https://fonts.gstatic.com",
				`img-src 'self' data: https://i.scdn.co https://*.googleusercontent.com`,
				"connect-src 'self'",
				"object-src 'none'",
				"upgrade-insecure-requests",
			].join("; ");

			headers.set("Content-Security-Policy", csp);
		}

		headers.set("X-Frame-Options", "DENY");
		headers.set("X-Content-Type-Options", "nosniff");
		headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
		headers.set("X-XSS-Protection", "0");
		setResponseHeaders(headers);

		return next({ context: { nonce } });
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [securityHeadersMiddleware],
}));
