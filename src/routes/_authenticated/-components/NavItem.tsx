import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { fonts } from "@/lib/theme/fonts";

interface NavItemProps {
	to: string;
	label: string;
	badge?: number;
	isActive: boolean;
}

const bodyFontStyle = { fontFamily: fonts.body } as const;

export const NavItem = memo(function NavItem({
	to,
	label,
	badge,
	isActive,
}: NavItemProps) {
	return (
		<Link
			to={to}
			className="flex w-full items-center justify-between py-2 text-left"
		>
			<span
				className={`${isActive ? "theme-text font-medium" : "theme-text-muted font-normal"} text-xs tracking-widest uppercase`}
				style={bodyFontStyle}
			>
				{label}
			</span>
			{badge !== undefined && badge > 0 && (
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={bodyFontStyle}
				>
					{badge}
				</span>
			)}
		</Link>
	);
});
