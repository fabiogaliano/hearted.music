/**
 * A fillable blank in a seed template's mad-lib sentence, rendered as a popover
 * listbox. Tapping the blank shows the WHOLE profile-derived option inventory
 * (no blind cycling that hides how many options exist), and picking is direct.
 * Inherits the surrounding text's font so the blank reads as part of the
 * sentence, not a control dropped into it.
 *
 * Keyboard: the trigger opens the list and moves focus into it; Up/Down/Home/End
 * move the active option (tracked via aria-activedescendant), Enter/Space picks,
 * Escape or Tab closes and hands focus back to the trigger — the listbox contract
 * the roles promise, rather than roles with no keyboard model behind them.
 */

import { useEffect, useId, useRef, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { SeedChoiceVM } from "../seedTypes";

export function SeedBlank({
	value,
	options,
	onPick,
}: {
	value: string;
	options: SeedChoiceVM[];
	onPick: (choice: SeedChoiceVM) => void;
}) {
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const openable = options.length > 1;
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listId = useId();

	const openList = () => {
		// Start the active option on the current value so arrowing begins where
		// the user already is, not at the top.
		const current = options.findIndex((o) => o.label === value);
		setActiveIndex(current >= 0 ? current : 0);
		setOpen(true);
	};

	const close = (returnFocus = true) => {
		setOpen(false);
		if (returnFocus) triggerRef.current?.focus();
	};

	// Moving focus into the list on open is what makes the arrow keys land here
	// instead of scrolling the page; close() hands focus back to the trigger.
	useEffect(() => {
		if (open) listRef.current?.focus();
	}, [open]);

	const commit = (choice: SeedChoiceVM) => {
		onPick(choice);
		close();
	};

	const onListKeyDown = (e: React.KeyboardEvent) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setActiveIndex((i) => (i + 1) % options.length);
				break;
			case "ArrowUp":
				e.preventDefault();
				setActiveIndex((i) => (i - 1 + options.length) % options.length);
				break;
			case "Home":
				e.preventDefault();
				setActiveIndex(0);
				break;
			case "End":
				e.preventDefault();
				setActiveIndex(options.length - 1);
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				commit(options[activeIndex]);
				break;
			case "Escape":
				e.preventDefault();
				close();
				break;
			case "Tab":
				close(false);
				break;
		}
	};

	return (
		// z-10 lifts the blank above a host row's stretched commit overlay, so
		// tapping the blank tunes it instead of committing the row.
		<span className="relative z-10 inline-block">
			<button
				ref={triggerRef}
				type="button"
				disabled={!openable}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={
					openable ? `${value} — change (${options.length} options)` : value
				}
				onClick={(e) => {
					e.stopPropagation();
					if (open) close(false);
					else openList();
				}}
				className={`mx-0.5 inline-block px-0.5 py-1 font-[inherit] text-[length:inherit] leading-tight focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] ${
					openable
						? // The screen's accent lives here: color marks the tunable word,
							// so "colored = changeable" reads without any extra chrome.
							"theme-primary cursor-pointer border-b border-dashed border-(--t-primary) transition-opacity hover:opacity-70"
						: // A single locked option isn't interactive — no accent, no underline.
							"theme-text"
				}`}
			>
				{value}
			</button>
			{open && (
				<>
					{/* Backdrop closes on outside click without a document listener. */}
					<div
						className="fixed inset-0 z-10"
						aria-hidden
						onClick={(e) => {
							e.stopPropagation();
							close(false);
						}}
					/>
					<div
						ref={listRef}
						role="listbox"
						tabIndex={-1}
						aria-label="Options"
						aria-activedescendant={`${listId}-opt-${activeIndex}`}
						onKeyDown={onListKeyDown}
						className="theme-border-color theme-surface-bg absolute top-full left-0 z-20 mt-1.5 flex min-w-[11rem] flex-col border py-1 not-italic shadow-sm outline-none"
					>
						{options.map((option, i) => (
							<button
								key={option.id}
								id={`${listId}-opt-${i}`}
								type="button"
								role="option"
								tabIndex={-1}
								aria-selected={option.label === value}
								onMouseEnter={() => setActiveIndex(i)}
								onClick={(e) => {
									e.stopPropagation();
									commit(option);
								}}
								className={`cursor-pointer px-3 py-1.5 text-left text-sm ${
									option.label === value ? "theme-text" : "theme-text-muted"
								}`}
								style={{
									fontFamily: fonts.body,
									// Active-descendant highlight doubles as the focus indicator
									// while focus sits on the listbox container.
									background:
										i === activeIndex
											? "color-mix(in srgb, var(--t-text) 8%, transparent)"
											: "transparent",
								}}
							>
								{option.label}
							</button>
						))}
					</div>
				</>
			)}
		</span>
	);
}
