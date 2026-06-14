import type { GlobalProvider } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

// Components like DashboardHeader read React Query (useActiveJobs, useDashboardSync).
// Server functions can't run in Ladle, so disable retries and refetching — stories
// that need seeded data nest their own QueryClientProvider over this one.
const storyQueryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity },
	},
});

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
	const raw = globalState?.control?.["theme"]?.value;
	const themeColor: ThemeColor =
		typeof raw === "string" && THEME_COLORS.includes(raw as ThemeColor)
			? (raw as ThemeColor)
			: "blue";

	const theme = getTheme(themeColor);

	return (
		<QueryClientProvider client={storyQueryClient}>
			<ThemeHueProvider theme={theme}>
				<div
					style={{
						background: theme.bg,
						color: theme.text,
						minHeight: "100vh",
						padding: 0,
						// Make the story canvas the containing block for position:fixed
						// descendants, so drawers/overlays (e.g. SpotlightPanel, the real
						// SongDetailPanel) stay inside the canvas instead of anchoring to the
						// window and covering Ladle's own sidebar. `layout` (not `paint`)
						// avoids clipping so tall stories still scroll, and (not `transform`)
						// avoids a 3D context that would flatten the cover-flow perspective.
						contain: "layout",
					}}
				>
					<KeyboardShortcutProvider>
						<StoryRouter>{children}</StoryRouter>
					</KeyboardShortcutProvider>
				</div>
			</ThemeHueProvider>
		</QueryClientProvider>
	);
};

export const argTypes = {
	theme: {
		control: { type: "select" },
		options: THEME_COLORS,
		defaultValue: "blue",
	},
};
