import { ArrowRightIcon } from "@phosphor-icons/react";
import { memo } from "react";
import { Button } from "@/components/ui/Button";
import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { fonts } from "@/lib/theme/fonts";
import type { CompletionScreenProps } from "../types";

const IMAGE_OUTLINE = "1px solid rgba(255, 255, 255, 0.1)";

export const CompletionScreen = memo(function CompletionScreen({
	stats,
	items,
	onExit,
}: CompletionScreenProps) {
	const additionsCopy =
		stats.totalAdditions === 1
			? "new addition to your playlists"
			: "new additions to your playlists";

	return (
		<StaggeredContent
			className="mx-auto max-w-4xl"
			staggerDelay={0.08}
			initialDelay={0.1}
		>
			<header className="mb-12 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
				<div>
					<p
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Matching
					</p>
					<h1
						className="theme-text mt-3 text-page-title font-extralight tracking-tight text-balance"
						style={{ fontFamily: fonts.display }}
					>
						You're caught up
					</h1>
				</div>
				<div
					className="theme-text-muted flex flex-wrap items-center gap-x-2 gap-y-2 text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{stats.dismissedCount > 0 && (
						<>
							<span className="tabular-nums">
								{stats.dismissedCount}{" "}
								<span className="tracking-widest uppercase">dismissed</span>
							</span>
							<span aria-hidden="true" className="opacity-40">
								·
							</span>
						</>
					)}
					<span className="tabular-nums">
						{stats.skippedCount}{" "}
						<span className="tracking-widest uppercase">skipped</span>
					</span>
				</div>
			</header>

			<div className="mb-6">
				<p
					className="theme-text font-extralight tabular-nums leading-[0.9]"
					style={{
						fontFamily: fonts.display,
						fontSize: "clamp(120px, 18vw, 220px)",
					}}
				>
					{stats.totalAdditions}
				</p>
				<p
					className="theme-text-muted mt-6 text-xl italic"
					style={{ fontFamily: fonts.display }}
				>
					{additionsCopy}
				</p>
			</div>

			{items.length > 0 && (
				<div className="mt-20">
					<p
						className="theme-text-muted mb-5 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Reviewed this round
					</p>
					<div className="flex gap-2">
						{items.slice(0, 5).map((item) => (
							<div
								key={item.id}
								className="group relative size-20 transition-transform duration-[220ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] hover:z-10 motion-safe:hover:-translate-y-1"
							>
								<img
									src={item.albumArtUrl ?? undefined}
									alt={`${item.name} — ${item.artist}`}
									loading="lazy"
									className="h-full w-full object-cover"
									style={{ outline: IMAGE_OUTLINE }}
								/>
								{/* Hover caption: title + artist. The opacity reveal is ungated
								so reduced-motion users still get it instantly; only the
								scale/rise easing is motion-safe. */}
								<div className="theme-surface-bg pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[180px] -translate-x-1/2 rounded-md px-3 py-2 text-center opacity-0 shadow-md group-hover:opacity-100 motion-safe:origin-bottom motion-safe:translate-y-1 motion-safe:scale-[0.97] motion-safe:transition-[opacity,transform] motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-safe:group-hover:translate-y-0 motion-safe:group-hover:scale-100">
									<p
										className="theme-text truncate text-xs font-medium"
										style={{ fontFamily: fonts.body }}
									>
										{item.name}
									</p>
									<p
										className="theme-text-muted truncate text-xs italic"
										style={{ fontFamily: fonts.display }}
									>
										{item.artist}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="mt-20">
				<Button
					variant="link"
					onClick={onExit}
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-base font-medium tracking-wide">
						Back to Home
					</span>
					<ArrowRightIcon
						size={16}
						weight="regular"
						className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
					/>
				</Button>
			</div>
		</StaggeredContent>
	);
});
