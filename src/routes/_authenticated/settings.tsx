import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { getMatchStrictnessPreference } from "@/lib/server/settings.functions";
import { useAuthenticatedTheme } from "@/lib/theme/authenticated-theme";

// `from=match` is set only by the "Adjust strictness" link in the matching
// empty state. It surfaces a "Back to match" affordance in the Matching
// section; because every other entry point to /settings (sidebar, upgrade CTA)
// omits it, the param — and the button — clear themselves the moment the user
// navigates away, scoping the round-trip to exactly this hop.
interface SettingsSearch {
	from?: "match";
}

function validateSettingsSearch(
	search: Record<string, unknown>,
): SettingsSearch {
	return { from: search.from === "match" ? "match" : undefined };
}

export const Route = createFileRoute("/_authenticated/settings")({
	validateSearch: validateSettingsSearch,
	loader: () => getMatchStrictnessPreference(),
	component: SettingsRoute,
});

function SettingsRoute() {
	const { account, billingState, session } = Route.useRouteContext();
	const { themeColor, setThemeColor } = useAuthenticatedTheme();
	const currentStrictness = Route.useLoaderData();
	const { from } = Route.useSearch();

	return (
		<SettingsPage
			accountId={session.accountId}
			handle={account?.handle ?? null}
			email={account?.email ?? null}
			imageUrl={account?.image_url ?? null}
			currentTheme={themeColor}
			onThemeChange={setThemeColor}
			currentStrictness={currentStrictness}
			billingState={billingState}
			cameFromMatch={from === "match"}
		/>
	);
}
