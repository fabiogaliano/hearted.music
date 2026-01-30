/**
 * Dashboard sidebar navigation
 *
 * Contains logo, navigation links, and user section.
 * Fixed position with editorial minimal styling.
 */

import { useLocation } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { NavItem } from "./NavItem";
import type { NavItem as NavItemType } from "../types";

interface SidebarProps {
	theme: ThemeConfig;
	userName: string;
	pendingCount: number;
}

const NAV_ITEMS: Array<{ id: NavItemType; label: string; path: string }> = [
	{ id: "home", label: "Home", path: "/dashboard" },
	{ id: "match", label: "Match Songs", path: "/dashboard/match" },
	{ id: "liked", label: "Liked Songs", path: "/dashboard/liked" },
	{ id: "playlists", label: "Playlists", path: "/dashboard/playlists" },
	{ id: "settings", label: "Settings", path: "/dashboard/settings" },
];

export function Sidebar({ theme, userName, pendingCount }: SidebarProps) {
	const location = useLocation();
	const currentPath = location.pathname;

	const getActiveId = (): NavItemType => {
		if (currentPath === "/dashboard" || currentPath === "/dashboard/") {
			return "home";
		}
		const item = NAV_ITEMS.find(
			(item) => item.path !== "/dashboard" && currentPath.startsWith(item.path),
		);
		return item?.id ?? "home";
	};

	const activeId = getActiveId();

	return (
		<aside
			className="sticky top-0 flex h-screen w-64 flex-col border-r px-6 py-8"
			style={{ borderColor: theme.border }}
		>
			<h1
				className="text-3xl font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				sorted.music
			</h1>

			<nav className="mt-12 flex-1">
				<div className="space-y-6">
					{NAV_ITEMS.map((item) => (
						<NavItem
							key={item.id}
							theme={theme}
							label={item.label}
							path={item.path}
							isActive={activeId === item.id}
							badge={
								item.id === "match" && pendingCount > 0
									? pendingCount
									: undefined
							}
						/>
					))}
				</div>
			</nav>

			<div className="border-t pt-6" style={{ borderColor: theme.border }}>
				<p
					className="text-sm"
					style={{ fontFamily: fonts.body, color: theme.text }}
				>
					{userName}
				</p>
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Free Plan
				</p>
			</div>
		</aside>
	);
}
