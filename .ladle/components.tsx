import type { GlobalProvider } from "@ladle/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import { getTheme } from "@/lib/theme/useTheme";
import type { ThemeColor } from "@/lib/theme/types";
import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import "./ladle.css";
import "@/styles.css";

const THEME_COLORS: ThemeColor[] = ["blue", "green", "rose", "lavender"];

function StoryRouter({ children }: { children: React.ReactNode }) {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<Outlet />
				{children}
			</>
		),
	});

	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});

	const catchAllRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "$",
		component: () => null,
	});

	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, catchAllRoute]),
		history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
	});

	return <RouterProvider router={router} />;
}

export const Provider: GlobalProvider = ({ children, globalState }) => {
	const raw = globalState?.control?.["theme"];
	const themeColor: ThemeColor =
		typeof raw === "string" && THEME_COLORS.includes(raw as ThemeColor)
			? (raw as ThemeColor)
			: "blue";

	const theme = getTheme(themeColor);

	return (
		<ThemeHueProvider theme={theme}>
			<div
				style={{
					background: theme.bg,
					color: theme.text,
					minHeight: "100vh",
					padding: 0,
				}}
			>
				<KeyboardShortcutProvider>
					<StoryRouter>{children}</StoryRouter>
				</KeyboardShortcutProvider>
			</div>
		</ThemeHueProvider>
	);
};

export const argTypes = {
	theme: {
		control: { type: "select" },
		options: THEME_COLORS,
		defaultValue: "blue",
	},
};
