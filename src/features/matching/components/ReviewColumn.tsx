import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";

// Mirrors both columns' art/cover height cap, so on short viewports either
// review column collapses in step with its counterpart instead of forcing a
// tall row that pushes the controls below the fold or under the launcher.
// The 80px reserve is two things: 40px for the fixed feedback launcher, plus
// the 40px the card plane's p-5 adds above and below the columns. Move it with
// MatchingSession's padding or the controls slide back under the launcher.
export const REVIEW_COLUMN_MIN_HEIGHT =
	"min(clamp(300px, 34vw, 620px), calc(56dvh - 80px))";

interface ReviewColumnFrameProps {
	children: ReactNode;
}

/** Outer shell shared by the song-match and playlist-suggestion columns: fixed
 *  min-height, the seam dividing this column from the review subject beside it,
 *  and the mobile-only top border that restores the visual break the
 *  two-column grid gives at lg. */
export function ReviewColumnFrame({ children }: ReviewColumnFrameProps) {
	return (
		// The seam is drawn here rather than as a gap because both columns now sit
		// on ONE card plane — it has to read as a plane divided, not as two planes
		// abutting. plane-rule (a 9% ink mix) not --t-border, which is a heavy line
		// on a raised fill. Side-by-side only: stacked, the rule below is the seam.
		<div
			className="plane-rule flex flex-col lg:border-l lg:pl-8"
			style={{ minHeight: REVIEW_COLUMN_MIN_HEIGHT }}
		>
			{/* Below lg the column stacks directly under its counterpart with only the
			grid gap between them; this rule restores the visual break the two-column
			split gives on wider viewports. Hidden at lg, where the columns sit side
			by side. */}
			<div className="plane-rule mb-8 border-t lg:hidden" />
			{children}
		</div>
	);
}

interface AnimatedReviewPanelProps {
	prefersReducedMotion: boolean;
	/** Skip the slide and swap immediately — see the section's suppressTransition. */
	instant?: boolean;
	children: ReactNode;
}

/** Slide/fade wrapper for the panel that swaps per review subject (song or
 *  playlist). Identical config for both variants — only the subject's key
 *  differs, so keying lives with the caller's AnimatePresence. */
export function AnimatedReviewPanel({
	prefersReducedMotion,
	instant,
	children,
}: AnimatedReviewPanelProps) {
	// While exiting, this subtree is still mounted but stale; block input so
	// users cannot click actions that belong to the previous review subject.
	const isPresent = useIsPresent();
	const skip = instant || prefersReducedMotion;
	return (
		<motion.div
			className="flex flex-1 flex-col"
			initial={skip ? false : { opacity: 0, x: 20 }}
			animate={{
				opacity: 1,
				x: 0,
				transition: skip
					? { duration: 0 }
					: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
			}}
			exit={
				skip
					? {}
					: {
							opacity: 0,
							x: -20,
							transition: { duration: 0.18, ease: [0.645, 0.045, 0.355, 1] },
						}
			}
			style={{ pointerEvents: isPresent ? "auto" : "none" }}
		>
			{children}
		</motion.div>
	);
}

/** "All suggestions reviewed." — the shared empty state for a review list. */
export function ReviewEmptyState() {
	return (
		<p className="theme-text-muted text-sm" style={{ fontFamily: fonts.body }}>
			All suggestions reviewed.
		</p>
	);
}

interface RefreshBannerProps {
	visible: boolean;
	prefersReducedMotion: boolean;
	onRefresh?: () => void;
}

/** "Real matches are ready" banner — song-mode only, but its enter/exit
 *  animation is the shared height-collapse treatment other banners in this
 *  column family use, so it lives here rather than duplicated inline. */
export function RefreshBanner({
	visible,
	prefersReducedMotion,
	onRefresh,
}: RefreshBannerProps) {
	return (
		<AnimatePresence>
			{visible && (
				<motion.button
					type="button"
					onClick={onRefresh}
					initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={
						prefersReducedMotion
							? {}
							: {
									opacity: 0,
									height: 0,
									transition: {
										duration: 0.15,
										ease: [0.645, 0.045, 0.355, 1],
									},
								}
					}
					transition={{ duration: 0.25, ease: [0.165, 0.84, 0.44, 1] }}
					// It's a button, so it gets a pressable fill and a focus edge it never
					// had — a flat full-bleed band gave no sign it was clickable. The chip
					// tier, not the plane tier: this now sits INSIDE the card plane, where
					// a plane on a plane computes the same fill and the banner would
					// vanish at rest. A control resting on a plane steps down.
					className="theme-text chip-raised chip-raised-hover squircle focus-edge mt-3 flex w-full items-center justify-between overflow-hidden rounded-[12px] px-4 py-2.5"
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-xs">Real matches are ready</span>
					<span className="theme-primary text-xs font-medium tracking-wider uppercase">
						Show
					</span>
				</motion.button>
			)}
		</AnimatePresence>
	);
}

export interface ReviewControlsProps {
	disabled: boolean;
	isLastItem: boolean;
	/** Drives the Reject button's singular/plural label. */
	count: number;
	/** Label shown on Next when this isn't the last item — "Skip Song" / "Skip Playlist". */
	nextLabel: string;
	onDismiss: () => void | Promise<void>;
	onPrevious?: () => void;
	onNext: () => void;
}

// Lives outside the keyed AnimatePresence subtree so it always renders against
// the latest committed review subject. Stale DOM from the exiting panel can't
// intercept rapid Next clicks.
export function ReviewControls({
	disabled,
	isLastItem,
	count,
	nextLabel,
	onDismiss,
	onPrevious,
	onNext,
}: ReviewControlsProps) {
	return (
		<div className="mt-8 flex items-center justify-between">
			<Button
				variant="ghost"
				size="sm"
				disabled={disabled}
				onClick={onDismiss}
				style={{ fontFamily: fonts.body }}
			>
				<span className="inline-flex min-h-11 items-center gap-1.5">
					<XIcon size={14} weight="regular" />
					{count === 1 ? "Reject Match" : "Reject Matches"}
				</span>
			</Button>

			<div className="flex items-center gap-6">
				{onPrevious && (
					<Button
						variant="ghost"
						size="sm"
						disabled={disabled}
						onClick={onPrevious}
						style={{ fontFamily: fonts.body }}
					>
						<span className="inline-flex min-h-11 items-center gap-1.5">
							<ArrowLeftIcon size={14} weight="regular" />
							Previous
						</span>
					</Button>
				)}
				<Button
					variant="link"
					disabled={disabled}
					onClick={onNext}
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-base font-medium tracking-wide">
						{isLastItem ? "Finish matching" : nextLabel}
					</span>
					<ArrowRightIcon
						size={16}
						weight="regular"
						className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
					/>
				</Button>
			</div>
		</div>
	);
}
