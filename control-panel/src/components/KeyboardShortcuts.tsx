import { useEffect, useRef } from "react";
import { registerOpenModal } from "../lib/modal-open";

interface Shortcut {
	keys: string[];
	label: string;
}

interface ShortcutGroup {
	title: string;
	shortcuts: Shortcut[];
}

const IS_MAC =
	typeof navigator !== "undefined" &&
	/Mac|iP(hone|ad|od)/.test(navigator.platform);

const GROUPS: ShortcutGroup[] = [
	{
		title: "Global",
		shortcuts: [
			{ keys: [IS_MAC ? "⌘" : "Ctrl", "K"], label: "Command palette" },
			{ keys: ["?"], label: "Keyboard shortcuts" },
			{ keys: ["Esc"], label: "Close menus & dialogs" },
		],
	},
	{
		title: "Review queues",
		shortcuts: [
			{ keys: ["J"], label: "Next item" },
			{ keys: ["K"], label: "Previous item" },
			{ keys: ["A"], label: "Approve focused item" },
			{ keys: ["/"], label: "Focus search" },
		],
	},
	{
		title: "Command palette",
		shortcuts: [
			{ keys: ["↑", "↓"], label: "Move selection" },
			{ keys: ["↵"], label: "Open selection" },
		],
	},
];

export function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const unregister = registerOpenModal();
		panelRef.current?.focus();
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			unregister();
		};
	}, [onClose]);

	return (
		<div className="modal-root">
			<button
				type="button"
				className="modal-backdrop"
				aria-label="Close keyboard shortcuts"
				onClick={onClose}
			/>
			<div
				ref={panelRef}
				className="modal-panel shortcuts-panel"
				role="dialog"
				aria-modal="true"
				aria-label="Keyboard shortcuts"
				tabIndex={-1}
			>
				<h2 className="modal-title">Keyboard shortcuts</h2>
				<div className="shortcuts-groups">
					{GROUPS.map((group) => (
						<section key={group.title} className="shortcuts-group">
							<h3>{group.title}</h3>
							<dl>
								{group.shortcuts.map((shortcut) => (
									<div key={shortcut.label} className="shortcuts-row">
										<dt>{shortcut.label}</dt>
										<dd>
											{shortcut.keys.map((key) => (
												<kbd key={key}>{key}</kbd>
											))}
										</dd>
									</div>
								))}
							</dl>
						</section>
					))}
				</div>
			</div>
		</div>
	);
}
