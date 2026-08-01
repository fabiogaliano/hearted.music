const SKELETON_ROWS = [
	"skeleton-1",
	"skeleton-2",
	"skeleton-3",
	"skeleton-4",
	"skeleton-5",
	"skeleton-6",
	"skeleton-7",
	"skeleton-8",
	"skeleton-9",
	"skeleton-10",
] as const;

const skeletonFill = "color-mix(in srgb, var(--t-text) 8%, transparent)";
const coverFill = "color-mix(in srgb, var(--t-text) 11%, transparent)";

export function PreviewListSkeleton() {
	return (
		<div
			role="status"
			aria-label="Loading playlist preview"
			className="motion-safe:animate-pulse"
		>
			<span className="sr-only">Loading playlist preview</span>
			<div aria-hidden="true" className="flex flex-col">
				{SKELETON_ROWS.map((row, index) => (
					<div key={row} className="-mx-3 flex items-center gap-4 px-3 py-2">
						<div
							className="h-9 w-9 flex-none"
							style={{ background: coverFill }}
						/>
						<div className="min-w-0 flex-1 space-y-2">
							<div
								className="h-3"
								style={{
									width: `${52 + (index % 4) * 8}%`,
									background: skeletonFill,
								}}
							/>
							<div
								className="h-2.5"
								style={{
									width: `${24 + (index % 3) * 7}%`,
									background: skeletonFill,
								}}
							/>
						</div>
						<div className="flex h-10 w-10 flex-none items-center justify-center">
							<div
								className="h-3.5 w-3.5 rounded-full"
								style={{ background: skeletonFill }}
							/>
						</div>
						<div className="flex h-10 w-10 flex-none items-center justify-center">
							<div
								className="h-3.5 w-3.5 rounded-full"
								style={{ background: skeletonFill }}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
