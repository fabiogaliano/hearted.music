import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export function Drawer({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	// Detail drawers can be dismissed with Escape from anywhere inside them, and
	// closing hands focus back to whatever opened the drawer (usually a row's
	// "View" button) so keyboard users don't lose their place in the table.
	const triggerRef = useRef<HTMLElement | null>(
		document.activeElement as HTMLElement | null,
	);
	// Kept current every render so the mount-only effect below can always call
	// the latest onClose without needing to re-bind its listener.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		panelRef.current?.focus();
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") onCloseRef.current();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			triggerRef.current?.focus();
		};
	}, []);

	return (
		<div className="drawer-root">
			<button
				type="button"
				className="drawer-backdrop"
				aria-label="Close"
				onClick={onClose}
			/>
			<div
				ref={panelRef}
				className="drawer-panel"
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
			>
				<header className="drawer-head">
					<h2>{title}</h2>
					<button
						type="button"
						className="btn"
						onClick={onClose}
						aria-label="Close"
					>
						<XIcon size={15} weight="bold" />
					</button>
				</header>
				<div className="drawer-body">{children}</div>
			</div>
		</div>
	);
}
