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
	const hasBadge = badge !== undefined && badge > 0;
	return (
		<Link
			to={to}
			data-active={isActive || undefined}
			aria-current={isActive ? "page" : undefined}
			className="group flex w-full items-center justify-between py-2 text-left"
		>
			<span
				className={`text-xs tracking-widest uppercase transition-colors duration-150 ease motion-reduce:transition-none ${
					isActive
						? "theme-text font-medium"
						: "theme-text-muted font-normal group-hover:text-(--t-text) group-focus-visible:text-(--t-text)"
				}`}
				style={bodyFontStyle}
			>
				{label}
			</span>
			{hasBadge && (
				<span
					className={`text-xs tabular-nums transition-colors duration-150 ease motion-reduce:transition-none ${
						isActive
							? "theme-text"
							: "theme-text-muted group-hover:text-(--t-text) group-focus-visible:text-(--t-text)"
					}`}
					style={bodyFontStyle}
				>
					{badge}
				</span>
			)}
		</Link>
	);
});
