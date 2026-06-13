/**
 * Temporary one-time greeting for waitlist members who received the automatic
 * 500-song liked-song access grant. Mirrors PaywallDialog's portal/focus/escape
 * shell — staggered enter, plus a graceful exit via the shared dialog-content
 * "closing" keyframes — and an AnimatedHeart flourish. Remove this together with
 * getWaitlistWelcome once the cohort has been greeted.
 *
 * Copy lives behind a `content` prop so it can be iterated in Ladle without
 * touching the shell; the app renders the default.
 */

import { XIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "framer-motion";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { AnimatedHeart } from "@/features/landing/components/AnimatedHeart";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";

// Matches the dialog-content-out duration in styles.css; we hold the unmount
// just long enough for the exit keyframe to finish before calling onClose.
const EXIT_MS = 170;

export interface WaitlistWelcomeContent {
	title: ReactNode;
	body: ReactNode;
	highlight?: ReactNode;
	cta: string;
	/** Small line directly above the button, in the sign-off style. */
	thanks?: ReactNode;
	/** Small line below the button (e.g. "— fábio"). */
	signoff?: string;
}

export const defaultWaitlistWelcomeContent: WaitlistWelcomeContent = {
	title: (
		<>
			You're a <em>keeper</em>.
		</>
	),
	body: "A little gift for being here early: 500 of your songs, ready to tell their stories.",
	thanks: "— thank you",
	cta: "See what's inside",
};

interface WaitlistWelcomeDialogProps {
	onClose: () => void;
	content?: WaitlistWelcomeContent;
}

export function WaitlistWelcomeDialog({
	onClose,
	content = defaultWaitlistWelcomeContent,
}: WaitlistWelcomeDialogProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	const reduceMotion = useReducedMotion();
	const [closing, setClosing] = useState(false);
	const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Play the exit keyframe, then unmount. Reduced motion skips straight to the
	// unmount so there's no dead pause. Guarded so a double-trigger (esc + click)
	// doesn't schedule two unmounts.
	const requestClose = useCallback(() => {
		if (closing) return;
		if (reduceMotion) {
			onClose();
			return;
		}
		setClosing(true);
		exitTimer.current = setTimeout(onClose, EXIT_MS);
	}, [closing, reduceMotion, onClose]);

	useShortcut({
		key: "escape",
		handler: requestClose,
		description: "Close welcome dialog",
		scope: "modal",
		category: "actions",
		enabled: true,
	});

	useEffect(() => {
		const previouslyFocused = document.activeElement;
		dialogRef.current?.focus();

		return () => {
			if (exitTimer.current) clearTimeout(exitTimer.current);
			if (
				previouslyFocused instanceof HTMLElement &&
				previouslyFocused.isConnected
			) {
				previouslyFocused.focus();
			}
		};
	}, []);

	return createPortal(
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close"
				data-state={closing ? "closing" : undefined}
				className="dialog-backdrop absolute inset-0 cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={requestClose}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				tabIndex={-1}
				data-state={closing ? "closing" : undefined}
				className="theme-surface-bg theme-border-color dialog-content relative w-full max-w-[480px] border p-8 outline-none"
			>
				<Button
					variant="icon"
					onClick={requestClose}
					className="absolute top-4 right-4"
					aria-label="Close"
				>
					<XIcon size={16} />
				</Button>
				<div className="flex flex-col items-center gap-5 py-2">
					<div
						className="dialog-section flex justify-center"
						style={{ animationDelay: "0ms" }}
						aria-hidden="true"
					>
						<span style={{ fontSize: "3rem", lineHeight: 1 }}>
							<AnimatedHeart
								shouldAutoPlay={!reduceMotion}
								autoPlayDelayMs={480}
							/>
						</span>
					</div>
					<div
						className="dialog-section text-center"
						style={{ animationDelay: "90ms" }}
					>
						<p
							id={titleId}
							className="theme-text text-3xl leading-tight tracking-tight text-balance"
							style={{ fontFamily: fonts.display }}
						>
							{content.title}
						</p>
						<div
							id={descriptionId}
							className="theme-text-muted mt-3 space-y-3 text-left text-sm leading-relaxed text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							{content.body}
						</div>
					</div>
					{content.highlight && (
						<div
							className="dialog-section w-full"
							style={{ animationDelay: "180ms" }}
						>
							<div
								className="theme-border-color theme-text rounded-lg border px-4 py-3 text-center text-sm text-pretty"
								style={{ fontFamily: fonts.body }}
							>
								{content.highlight}
							</div>
						</div>
					)}
					<div
						className="dialog-section flex w-full flex-col items-center gap-3"
						style={{ animationDelay: "270ms" }}
					>
						{content.thanks && (
							<p
								className="theme-text-muted w-full text-right text-xs"
								style={{ fontFamily: fonts.body }}
							>
								{content.thanks}
							</p>
						)}
						<Button variant="primary" onClick={requestClose} className="w-full">
							{content.cta}
						</Button>
						{content.signoff && (
							<p
								className="theme-text-muted text-xs"
								style={{ fontFamily: fonts.body }}
							>
								{content.signoff}
							</p>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
