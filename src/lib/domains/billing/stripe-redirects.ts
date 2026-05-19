/**
 * Strict validators for Stripe-hosted redirect URLs forwarded to the browser.
 *
 * Browsers receive these URLs via `window.location.href` from billing flows.
 * If the billing service is ever misconfigured or compromised, only URLs that
 * pass these checks reach the user, which closes off arbitrary open-redirects
 * to phishing hosts.
 */

const STRIPE_CHECKOUT_HOST = "checkout.stripe.com";
const STRIPE_PORTAL_HOST = "billing.stripe.com";

function parseHttpsUrlWithHost(
	raw: string,
	expectedHost: string,
): string | null {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}

	if (parsed.protocol !== "https:") return null;
	if (parsed.hostname !== expectedHost) return null;

	return parsed.toString();
}

export function parseStripeCheckoutUrl(raw: string): string | null {
	return parseHttpsUrlWithHost(raw, STRIPE_CHECKOUT_HOST);
}

export function parseStripePortalUrl(raw: string): string | null {
	return parseHttpsUrlWithHost(raw, STRIPE_PORTAL_HOST);
}
