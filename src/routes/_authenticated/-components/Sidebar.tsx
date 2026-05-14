/**
 * Dashboard sidebar with navigation and user info.
 * Editorial magazine aesthetic with typography-driven design.
 */

import { Link, useMatchRoute } from "@tanstack/react-router";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { fonts } from "@/lib/theme/fonts";
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
	const matchRoute = useMatchRoute();

	const isRouteActive = (to: string) => {
		if (to === "/dashboard") {
			return matchRoute({ to, fuzzy: false }) !== false;
		}
		return matchRoute({ to, fuzzy: true }) !== false;
	};

	return (
		<aside className="theme-border-color sticky top-0 flex h-screen w-64 flex-col border-r px-6 py-8">
			<h1
				className="theme-text text-4xl font-extralight"
				style={{ fontFamily: fonts.display }}
			>
				hearted.
			</h1>

			<nav className="mt-10 flex-1">
				<div className="space-y-2">
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
				className="theme-border-color flex items-center gap-3 border-t pt-6 transition-opacity hover:opacity-70"
			>
				<UserAvatar name={userName} imageUrl={userImageUrl} />
				<div className="min-w-0">
					{userName && (
						<p
							className={`${isRouteActive("/settings") ? "theme-text font-medium" : "theme-text-muted font-normal"} truncate text-sm`}
							style={{ fontFamily: fonts.body }}
						>
							{userName}
						</p>
					)}
					<p
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						{userPlan}
					</p>
					{userBalance != null && (
						<p
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							{userBalance} {userBalance === 1 ? "song" : "songs"} to explore
						</p>
					)}
				</div>
			</Link>
		</aside>
	);
}
