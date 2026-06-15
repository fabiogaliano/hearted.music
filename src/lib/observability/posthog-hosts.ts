const DEFAULT_POSTHOG_API_HOST = "https://eu.i.posthog.com";
const DEFAULT_POSTHOG_ASSET_HOST = "https://eu-assets.i.posthog.com";
const DEFAULT_POSTHOG_UI_HOST = "https://eu.posthog.com";

// Deliberately neutral: a path containing "posthog" is matched by ad/privacy
// blocker filter lists (EasyPrivacy et al.) by substring, so the reverse proxy
// gets ERR_BLOCKED_BY_CLIENT even though it's same-origin. "/api/pulse-h" carries
// no analytics-vendor signal, so the bulk of blocked sessions get through. Sentry
// rides the sibling "/api/pulse-s" — same neutral family, distinct path, so one
// blocker rule can't take down analytics and error reporting together.
export const POSTHOG_TUNNEL_PATH = "/api/pulse-h";

export interface PostHogHosts {
	apiHost: string;
	assetHost: string;
	uiHost: string;
}

export type PostHogHostResolution =
	| {
			kind: "ok";
			value: PostHogHosts;
	  }
	| {
			kind: "invalid";
			reason: string;
	  };

interface ResolvePostHogHostsOptions {
	strict?: boolean;
}

function defaultPostHogHosts(): PostHogHosts {
	return {
		apiHost: DEFAULT_POSTHOG_API_HOST,
		assetHost: DEFAULT_POSTHOG_ASSET_HOST,
		uiHost: DEFAULT_POSTHOG_UI_HOST,
	};
}

function invalidPostHogHost(
	reason: string,
	strict: boolean,
): PostHogHostResolution {
	return strict
		? { kind: "invalid", reason }
		: { kind: "ok", value: defaultPostHogHosts() };
}

export function resolvePostHogHosts(
	configuredHost: string | undefined,
	options: ResolvePostHogHostsOptions = {},
): PostHogHostResolution {
	const strict = options.strict ?? true;
	if (!configuredHost) {
		return {
			kind: "ok",
			value: defaultPostHogHosts(),
		};
	}

	let apiHost: string;
	try {
		apiHost = new URL(configuredHost).origin;
	} catch {
		return invalidPostHogHost(
			"VITE_PUBLIC_POSTHOG_HOST must be a valid URL when PostHog is enabled.",
			strict,
		);
	}

	if (apiHost !== DEFAULT_POSTHOG_API_HOST) {
		return invalidPostHogHost(
			"hearted is configured for PostHog EU only. Use https://eu.i.posthog.com.",
			strict,
		);
	}

	return {
		kind: "ok",
		value: {
			apiHost,
			assetHost: DEFAULT_POSTHOG_ASSET_HOST,
			uiHost: DEFAULT_POSTHOG_UI_HOST,
		},
	};
}

export function isPostHogAssetPath(pathname: string): boolean {
	return pathname.startsWith("/array/") || pathname.startsWith("/static/");
}

export function getPostHogProxyUpstreamUrl(
	hosts: PostHogHosts,
	pathname: string,
	search: string,
): string {
	const upstreamHost = isPostHogAssetPath(pathname)
		? hosts.assetHost
		: hosts.apiHost;
	return `${upstreamHost}${pathname}${search}`;
}
