/**
 * Dashboard sidebar with navigation and user info.
 * Editorial magazine aesthetic with typography-driven design.
 */

import { useMatchRoute } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { NavItem } from "./NavItem";

interface SidebarProps {
	unsortedCount: number;
	userName: string | null;
	userPlan: string;
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
	{ to: "/settings", label: "Settings" },
];

function getInitials(name: string | null): string {
	if (!name) return "?";
	const parts = name.trim().split(/\s+/);
	if (parts.length >= 2) {
		return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
	}
	return name[0]?.toUpperCase() ?? "?";
}

function UserAvatar({
	name,
	imageUrl,
}: {
	name: string | null;
	imageUrl?: string | null;
}) {
	const theme = useTheme();

	if (imageUrl) {
		return (
			<img
				src={imageUrl}
				alt=""
				className="h-8 w-8 shrink-0 rounded-full object-cover"
			/>
		);
	}

	return (
		<div
			className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
			style={{
				background: theme.surfaceDim,
				color: theme.text,
				fontFamily: fonts.body,
			}}
		>
			{getInitials(name)}
		</div>
	);
}

export function Sidebar({
	unsortedCount,
	userName,
	userPlan,
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

			<div
				className="flex items-center gap-3 border-t pt-6"
				style={{ borderColor: theme.border }}
			>
				<UserAvatar name={userName} imageUrl={userImageUrl} />
				<div className="min-w-0">
					{userName && (
						<p
							className="truncate text-sm"
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
			</div>
		</aside>
	);
}
