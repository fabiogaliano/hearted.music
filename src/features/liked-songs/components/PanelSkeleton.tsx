export function PanelSkeleton() {
	return (
		<div className="theme-bg fixed inset-0 z-50 overflow-hidden">
			<div className="relative" style={{ height: 450 }}>
				<div
					className="theme-surface-bg absolute animate-pulse rounded-lg"
					style={{
						left: 20,
						top: 30,
						width: 112,
						height: 112,
					}}
				/>

				<div
					className="theme-surface-bg absolute animate-pulse rounded"
					style={{
						left: 148,
						top: 50,
						width: 200,
						height: 24,
					}}
				/>

				<div
					className="theme-surface-bg absolute animate-pulse rounded"
					style={{
						left: 148,
						top: 84,
						width: 140,
						height: 16,
					}}
				/>
			</div>

			<div className="space-y-6 px-5">
				<div
					className="theme-surface-bg animate-pulse rounded"
					style={{
						width: "100%",
						height: 120,
					}}
				/>
				<div
					className="theme-surface-bg animate-pulse rounded"
					style={{
						width: "100%",
						height: 80,
					}}
				/>
			</div>
		</div>
	);
}
