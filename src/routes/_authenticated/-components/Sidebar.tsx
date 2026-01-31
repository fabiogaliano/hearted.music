/**
 * Dashboard sidebar with navigation and user info.
 * Editorial magazine aesthetic with typography-driven design.
 */

import { useMatchRoute } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { NavItem } from "./NavItem";

interface SidebarProps {
	theme: ThemeConfig;
	unsortedCount: number;
	userName: string | null;
	userPlan: string;
}

interface NavItemConfig {
	to: string;
	label: string;
	hasBadge?: boolean;
}

const NAV_ITEMS: NavItemConfig[] = [
	{ to: "/dashboard", label: "Home" },
	{ to: "/match", label: "Match Songs", hasBadge: true },
	{ to: "/liked-songs", label: "Liked Songs" },
	{ to: "/playlists", label: "Playlists" },
	{ to: "/settings", label: "Settings" },
];

export function Sidebar({
	theme,
	unsortedCount,
	userName,
	userPlan,
}: SidebarProps) {
	const matchRoute = useMatchRoute();

	const isRouteActive = (to: string) => {
		if (to === "/dashboard") {
			return matchRoute({ to, fuzzy: false }) !== false;
		}
		return matchRoute({ to, fuzzy: true }) !== false;
	};

	return (
		<aside
			className="sticky top-0 flex h-screen w-64 flex-col border-r px-6 py-8"
			style={{ borderColor: theme.border }}
		>
			<h1
				className="text-3xl font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				hearted.
			</h1>

			<nav className="mt-12 flex-1">
				<div className="space-y-6">
					{NAV_ITEMS.map((item) => (
						<NavItem
							key={item.to}
							to={item.to}
							label={item.label}
							badge={item.hasBadge ? unsortedCount : undefined}
							isActive={isRouteActive(item.to)}
							theme={theme}
						/>
					))}
				</div>
			</nav>

			<div className="border-t pt-6" style={{ borderColor: theme.border }}>
				{userName && (
					<p
						className="text-sm"
						style={{ fontFamily: fonts.body, color: theme.text }}
					>
						{userName}
					</p>
				)}
				<p
					className="text-xs uppercase tracking-widest"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{userPlan}
				</p>
			</div>
		</aside>
	);
}
