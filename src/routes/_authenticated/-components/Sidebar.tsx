/**
 * Dashboard sidebar with navigation and user info.
 * Editorial magazine aesthetic with typography-driven design.
 */

import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { fonts } from "@/lib/theme/fonts";
import { NavItem } from "./NavItem";

const bodyFontStyle = { fontFamily: fonts.body } as const;
const displayFontStyle = { fontFamily: fonts.display } as const;

interface SidebarProps {
	unsortedCount: number;
	handle: string | null;
	userPlan: string;
	userBalance?: number | null;
	userImageUrl?: string | null;
	showUpgradeCTA?: boolean;
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
	handle,
	userPlan,
	userBalance,
	userImageUrl,
	showUpgradeCTA = false,
}: SidebarProps) {
	const matchRoute = useMatchRoute();

	const isRouteActive = (to: string) => {
		if (to === "/dashboard") {
			return matchRoute({ to, fuzzy: false }) !== false;
		}
		return matchRoute({ to, fuzzy: true }) !== false;
	};

	const isSettingsActive = isRouteActive("/settings");
	const balanceLabel =
		userBalance != null
			? `${userBalance} ${userBalance === 1 ? "song" : "songs"} to explore`
			: null;

	return (
		<aside className="theme-bg theme-border-color sticky top-0 z-10 flex h-screen w-64 flex-col border-r px-6 py-8">
			<Link
				to="/dashboard"
				aria-label="Hearted home"
				className="theme-text inline-block self-start text-4xl font-extralight tracking-tight transition-opacity duration-150 ease motion-reduce:transition-none hover:opacity-75"
				style={displayFontStyle}
			>
				hearted.
			</Link>

			<nav aria-label="Primary" className="mt-10 flex-1">
				<ul className="space-y-1">
					{NAV_ITEMS.map((item) => (
						<li key={item.to}>
							<NavItem
								to={item.to}
								label={item.label}
								badge={item.hasBadge ? unsortedCount : undefined}
								isActive={isRouteActive(item.to)}
							/>
						</li>
					))}
				</ul>
			</nav>

			<Link
				to="/settings"
				hash={showUpgradeCTA ? "settings-section-subscription" : undefined}
				aria-label={
					showUpgradeCTA ? "Settings — upgrade your plan" : "Settings"
				}
				data-active={isSettingsActive || undefined}
				className="theme-border-color group relative -mx-6 -mb-8 mt-6 flex items-center gap-3 border-t px-6 pt-6 pb-8 transition-colors duration-150 ease motion-reduce:transition-none hover:bg-[color-mix(in_oklch,var(--t-text)_5%,transparent)] data-[active]:bg-[color-mix(in_oklch,var(--t-text)_7%,transparent)]"
			>
				<UserAvatar name={handle} imageUrl={userImageUrl} />
				<div className="min-w-0 flex-1">
					{handle && (
						<p
							className={`truncate text-sm transition-colors duration-150 ease motion-reduce:transition-none ${
								isSettingsActive
									? "theme-text font-medium"
									: "theme-text-muted font-normal group-hover:text-(--t-text) group-focus-visible:text-(--t-text)"
							}`}
							style={bodyFontStyle}
						>
							@{handle}
						</p>
					)}
					<p
						className="theme-text-muted text-xxs tracking-widest uppercase"
						style={bodyFontStyle}
					>
						{userPlan}
					</p>
					{showUpgradeCTA ? (
						<p
							className="theme-text mt-1.5 inline-flex items-baseline gap-1.5 text-base leading-none"
							style={displayFontStyle}
						>
							<em>Upgrade</em>
							<ArrowRightIcon
								aria-hidden="true"
								weight="light"
								className="size-3.5 -translate-x-0.5 self-center transition-transform duration-200 ease-out group-hover:translate-x-0 group-focus-visible:translate-x-0 motion-reduce:transition-none"
							/>
						</p>
					) : (
						balanceLabel && (
							<p
								className="theme-text-muted text-xs tabular-nums"
								style={bodyFontStyle}
							>
								{balanceLabel}
							</p>
						)
					)}
				</div>
			</Link>
		</aside>
	);
}
