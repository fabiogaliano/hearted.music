import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface NavItemProps {
	to: string;
	label: string;
	badge?: number;
	isActive: boolean;
}

export function NavItem({ to, label, badge, isActive }: NavItemProps) {
	const theme = useTheme();
	return (
		<Link
			to={to}
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
			{badge !== undefined && badge > 0 && (
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
