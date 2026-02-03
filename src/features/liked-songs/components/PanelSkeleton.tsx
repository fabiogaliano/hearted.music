import { useTheme } from "@/lib/theme/ThemeHueProvider";

export function PanelSkeleton() {
	const theme = useTheme();
	return (
		<div
			className="fixed inset-0 z-50 overflow-hidden"
			style={{ backgroundColor: theme.bg }}
		>
			{/* Hero area skeleton */}
			<div className="relative" style={{ height: 450 }}>
				{/* Album art skeleton */}
				<div
					className="absolute animate-pulse rounded-lg"
					style={{
						left: 20,
						top: 30,
						width: 112,
						height: 112,
						backgroundColor: theme.surface,
					}}
				/>

				{/* Title skeleton */}
				<div
					className="absolute animate-pulse rounded"
					style={{
						left: 148,
						top: 50,
						width: 200,
						height: 24,
						backgroundColor: theme.surface,
					}}
				/>

				{/* Artist skeleton */}
				<div
					className="absolute animate-pulse rounded"
					style={{
						left: 148,
						top: 84,
						width: 140,
						height: 16,
						backgroundColor: theme.surface,
					}}
				/>
			</div>

			{/* Content area skeleton */}
			<div className="px-5 space-y-6">
				{/* Section skeleton */}
				<div
					className="animate-pulse rounded"
					style={{
						width: "100%",
						height: 120,
						backgroundColor: theme.surface,
					}}
				/>
				<div
					className="animate-pulse rounded"
					style={{
						width: "100%",
						height: 80,
						backgroundColor: theme.surface,
					}}
				/>
			</div>
		</div>
	);
}
