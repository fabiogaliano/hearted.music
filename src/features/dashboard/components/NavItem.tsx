/**
 * Navigation item for sidebar
 *
 * Displays a navigation link with optional badge for counts.
 * Active state shown with heavier font weight.
 */

import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";

interface NavItemProps {
	theme: ThemeConfig;
	label: string;
	path: string;
	isActive: boolean;
	badge?: number;
}

export function NavItem({ theme, label, path, isActive, badge }: NavItemProps) {
	return (
		<Link
			to={path}
			className="flex w-full items-center justify-between text-left"
		>
			<span
				className="text-lg"
				style={{
					fontFamily: fonts.body,
					color: isActive ? theme.text : theme.textMuted,
					fontWeight: isActive ? 500 : 400,
				}}
			>
				{label}
			</span>
			{badge !== undefined && (
				<span
					className="text-sm tabular-nums"
					style={{
						fontFamily: fonts.body,
						color: theme.text,
					}}
				>
					{badge}
				</span>
			)}
		</Link>
	);
}
