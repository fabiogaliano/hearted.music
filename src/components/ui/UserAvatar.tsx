import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

function getInitials(name: string | null): string {
	if (!name) return "?";
	const parts = name.trim().split(/\s+/);
	if (parts.length >= 2) {
		return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
	}
	return name[0]?.toUpperCase() ?? "?";
}

const SIZES = {
	sm: "h-8 w-8 text-xs",
	md: "h-12 w-12 text-sm",
} as const;

export function UserAvatar({
	name,
	imageUrl,
	size = "sm",
}: {
	name: string | null;
	imageUrl?: string | null;
	size?: keyof typeof SIZES;
}) {
	const theme = useTheme();

	if (imageUrl) {
		return (
			<img
				src={imageUrl}
				alt=""
				className={`${SIZES[size]} shrink-0 rounded-full object-cover`}
			/>
		);
	}

	return (
		<div
			className={`flex ${SIZES[size]} shrink-0 items-center justify-center rounded-full font-medium`}
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
