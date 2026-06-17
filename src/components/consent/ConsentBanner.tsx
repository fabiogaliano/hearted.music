import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useConsent } from "@/lib/consent/consent-context";
import { fonts } from "@/lib/theme/fonts";

export function ConsentBanner() {
	const { showBanner, isUpdating, grant, deny } = useConsent();
	const titleId = useId();
	const descId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	const acceptRef = useRef<HTMLButtonElement>(null);

	// Forced-choice modal: focus moves into the dialog and body scroll locks,
	// so the page behind can't be used without deciding. There is deliberately
	// no scrim-click dismiss and no Escape — declining (one equal-effort click)
	// is the only way past. That keeps it a genuine choice (lawful: refusing is
	// as easy as accepting) while removing the "ignore it" escape.
	useEffect(() => {
		if (!showBanner) return;
		acceptRef.current?.focus();
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [showBanner]);

	if (!showBanner) return null;

	// Trap Tab within the dialog's two actions so keyboard users can't reach
	// the inert page behind the modal.
	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Tab") return;
		const focusables =
			dialogRef.current?.querySelectorAll<HTMLElement>("button");
		if (!focusables || focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	return (
		<div className="dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descId}
				onKeyDown={handleKeyDown}
				className="theme-surface-bg theme-border-color dialog-content w-full max-w-md border p-8"
			>
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Privacy
				</p>
				<h2
					id={titleId}
					className="theme-text mt-3 text-2xl font-extralight"
					style={{ fontFamily: fonts.body }}
				>
					How we use your data
				</h2>
				<p
					id={descId}
					className="theme-text mt-4 text-sm leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					hearted. uses cookies to understand errors and make the product
					better, no data is sold in the process.
				</p>

				<div className="mt-8 flex gap-3">
					<Button
						variant="secondary"
						onClick={deny}
						disabled={isUpdating}
						className="flex-1"
					>
						Decline
					</Button>
					<Button
						ref={acceptRef}
						variant="primary"
						onClick={grant}
						disabled={isUpdating}
						className="flex-1"
					>
						Accept
					</Button>
				</div>
				<p
					aria-live="polite"
					className="theme-text-muted mt-3 text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{isUpdating ? "Saving your choice…" : " "}
				</p>
			</div>
		</div>
	);
}
