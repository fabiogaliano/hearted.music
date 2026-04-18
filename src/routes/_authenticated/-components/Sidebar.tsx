/**
 * Dashboard sidebar with navigation and user info.
 * Editorial magazine aesthetic with typography-driven design.
 */

import { Link, useMatchRoute } from "@tanstack/react-router";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { NavItem } from "./NavItem";

interface SidebarProps {
	unsortedCount: number;
	userName: string | null;
	userPlan: string;
	userBalance?: number | null;
	userImageUrl?: string | null;
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
];

export function Sidebar({
	unsortedCount,
	userName,
	userPlan,
	userBalance,
	userImageUrl,
}: SidebarProps) {
	const theme = useTheme();
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
						/>
					))}
				</div>
			</nav>

			<Link
				to="/settings"
				className="flex items-center gap-3 border-t pt-6 transition-opacity hover:opacity-70"
				style={{ borderColor: theme.border }}
			>
				<UserAvatar name={userName} imageUrl={userImageUrl} />
				<div className="min-w-0">
					{userName && (
						<p
							className="truncate text-sm"
							style={{
								fontFamily: fonts.body,
								color: isRouteActive("/settings")
									? theme.text
									: theme.textMuted,
								fontWeight: isRouteActive("/settings") ? 500 : 400,
							}}
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
					{userBalance != null && (
						<p
							className="text-xs"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{userBalance} {userBalance === 1 ? "song" : "songs"} to explore
						</p>
					)}
				</div>
			</Link>
		</aside>
	);
}
