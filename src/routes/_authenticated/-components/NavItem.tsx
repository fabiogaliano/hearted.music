import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";

interface NavItemProps {
	to: string;
	label: string;
	badge?: number;
	isActive: boolean;
}

export function NavItem({ to, label, badge, isActive }: NavItemProps) {
	return (
		<Link
			to={to}
			className="flex w-full items-center justify-between py-2 text-left"
		>
			<span
				className={`${isActive ? "theme-text font-medium" : "theme-text-muted font-normal"} text-xs tracking-widest uppercase`}
				style={{ fontFamily: fonts.body }}
			>
				{label}
			</span>
			{badge !== undefined && badge > 0 && (
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{badge}
				</span>
			)}
		</Link>
	);
}
