import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { repairConnection } from "@/lib/extension/connection/repair";
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

// Same destination SpotifyReconnectLink armed for this verdict, kept so the
// click behaves exactly as the per-row links it replaces did.
const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

/** "Your Spotify session expired" — the review column's one reconnect home.
 *
 *  A dead token is account-level truth (QueueCardContent derives it once from
 *  the shared verdict), and it used to render as a Reconnect link in every
 *  suggestion row: N copies of one fact, each one displacing that row's Add
 *  AND its match reason. The state belongs above the list, not inside every
 *  item of it — so the rows keep their reasons and show a disabled Add, and
 *  this says once why it's disabled and how to fix it.
 *
 *  Deliberately NOT ExtensionAccountBannerView, whose two variants are tuned
 *  for the dashboard header and the create bar: both paint a surface that
 *  computes flat against the card plane this column sits on. It takes
 *  RefreshBanner's treatment instead, because that is what a banner on this
 *  plane already looks like.
 *
 *  No enter animation, unlike RefreshBanner: that one arrives mid-session when
 *  background matches land, so it has something to announce. This is true from
 *  first render or not at all. */
export function ReconnectBanner() {
	const queryClient = useQueryClient();
	const [repairing, setRepairing] = useState(false);

	const onReconnect = useCallback(() => {
		setRepairing(true);
		// repairConnection opens the armed Spotify login synchronously (invariant
		// 1 — nothing awaited first) and fires the silent re-pair in parallel. Its
		// promise can genuinely reject, and there is no recovery to show beyond
		// stopping the spinner: the next verdict poll re-renders this same banner.
		repairConnection({
			verdict: { kind: "spotify-disconnected" },
			queryClient,
			spotifyLoginUrl: SPOTIFY_LOGIN_URL,
		})
			.catch(() => {})
			.finally(() => setRepairing(false));
	}, [queryClient]);

	return (
		<button
			type="button"
			onClick={onReconnect}
			disabled={repairing}
			className="theme-text chip-raised chip-raised-hover squircle focus-edge mt-3 flex w-full items-center justify-between rounded-[12px] px-4 py-2.5 disabled:opacity-60"
			style={{ fontFamily: fonts.body }}
		>
			<span className="text-xs">Your Spotify session expired</span>
			<span className="theme-primary text-xs font-medium tracking-wider uppercase">
				{repairing ? "Reconnecting…" : "Reconnect"}
			</span>
		</button>
	);
}

export interface ReviewControlsProps {
	disabled: boolean;
	isLastItem: boolean;
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
				{/* "None of these", not "Reject Matches": this button and the X on each
				row both meant reject, at wildly different scopes — one suggestion
				versus every suggestion for this subject — and neither label carried
				the difference. "These" can only mean the whole list, which puts the
				scope in the words and leaves the row's X free to mean "not this one".
				It also drops the singular/plural fork the old copy needed. */}
				<span className="inline-flex min-h-11 items-center gap-1.5">
					<XIcon size={14} weight="regular" />
					None of these
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
