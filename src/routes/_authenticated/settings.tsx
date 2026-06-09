import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useAuthenticatedTheme } from "@/lib/theme/authenticated-theme";

export const Route = createFileRoute("/_authenticated/settings")({
	component: SettingsRoute,
});

function SettingsRoute() {
	const { account, billingState } = Route.useRouteContext();
	const { themeColor, setThemeColor } = useAuthenticatedTheme();

	return (
		<SettingsPage
			handle={account?.handle ?? null}
			email={account?.email ?? null}
			imageUrl={account?.image_url ?? null}
			currentTheme={themeColor}
			onThemeChange={setThemeColor}
			billingState={billingState}
		/>
	);
}
