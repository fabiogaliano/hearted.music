import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { getJson } from "../lib/api";
import { isModalOpen, registerOpenModal } from "../lib/modal-open";
import { listSavedViews, type SavedView } from "../lib/saved-views";
import type { AccountSearchResult } from "../lib/types";
import type { SectionKey } from "../lib/url-state";

export interface CommandPaletteSection {
	key: SectionKey;
	label: string;
}

// A flat, display-ordered command drives keyboard navigation; each rendered
// row maps to one of these by index so ↑/↓/Enter stay in sync with the groups.
interface Command {
	id: string;
	run: () => void;
}

export function CommandPalette({
	sections,
	onNavigate,
	onClose,
	onFocusTableSearch,
}: {
	sections: readonly CommandPaletteSection[];
	onNavigate: (section: SectionKey, params?: Record<string, string>) => void;
	onClose: () => void;
	onFocusTableSearch: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [accounts, setAccounts] = useState<AccountSearchResult[]>([]);
	const [accountError, setAccountError] = useState<string | null>(null);
	const [searchingAccounts, setSearchingAccounts] = useState(false);
	const [savedViews] = useState<SavedView[]>(listSavedViews);
	const [activeIndex, setActiveIndex] = useState(0);

	useEffect(() => {
		const unregister = registerOpenModal();
		inputRef.current?.focus();
		// Capture Escape at the window so it closes regardless of inner focus and
		// never reaches section/queue keyboard handlers underneath.
		function onEscape(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
		window.addEventListener("keydown", onEscape, true);
		return () => {
			window.removeEventListener("keydown", onEscape, true);
			unregister();
		};
	}, [onClose]);

	useEffect(() => {
		const trimmed = query.trim();
		if (!trimmed) {
			setAccounts([]);
			setAccountError(null);
			setSearchingAccounts(false);
			return;
		}
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setSearchingAccounts(true);
			setAccountError(null);
			getJson<{ accounts: AccountSearchResult[] }>(
				`/api/accounts/search?q=${encodeURIComponent(trimmed)}`,
			)
				.then((result) => {
					if (!cancelled) setAccounts(result.accounts);
				})
				.catch((reason: unknown) => {
					if (!cancelled) {
						setAccounts([]);
						setAccountError(
							reason instanceof Error ? reason.message : String(reason),
						);
					}
				})
				.finally(() => {
					if (!cancelled) setSearchingAccounts(false);
				});
		}, 150);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [query]);

	const normalizedQuery = query.trim().toLocaleLowerCase();
	const matchingSections = sections.filter((section) =>
		section.label.toLocaleLowerCase().includes(normalizedQuery),
	);
	const matchingViews = savedViews.filter((view) =>
		view.label.toLocaleLowerCase().includes(normalizedQuery),
	);

	function navigate(section: SectionKey, params?: Record<string, string>) {
		onNavigate(section, params);
		onClose();
	}

	function focusTableSearch() {
		if (isModalOpen()) {
			onClose();
			window.requestAnimationFrame(onFocusTableSearch);
		}
	}

	// Ordered exactly as the groups render below so index ↔ row stays aligned.
	// A tiny per-render list — no memo needed; keeps the closures always fresh.
	const commands: Command[] = [];
	if (normalizedQuery.length === 0) {
		commands.push({ id: "table-search", run: focusTableSearch });
	}
	for (const section of matchingSections) {
		commands.push({
			id: `section-${section.key}`,
			run: () => navigate(section.key),
		});
	}
	for (const view of matchingViews) {
		commands.push({
			id: `view-${view.id}`,
			run: () =>
				navigate(
					view.section,
					Object.fromEntries(new URLSearchParams(view.params)),
				),
		});
	}
	for (const account of accounts) {
		commands.push({
			id: `account-${account.id}`,
			run: () => navigate("users", { user: account.id }),
		});
	}

	// Re-anchor the highlight to the first row whenever the query changes.
	// Results only grow (not shrink) between keystrokes as accounts load, and
	// row activation is index-guarded, so a stale index can never mis-fire.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on query intentionally
	useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	// Keep the highlighted row scrolled into view during keyboard navigation.
	useEffect(() => {
		const el = listRef.current?.querySelector<HTMLElement>(
			`#cp-cmd-${activeIndex}`,
		);
		el?.scrollIntoView?.({ block: "nearest" });
	}, [activeIndex]);

	function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (commands.length === 0) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((i) => (i + 1) % commands.length);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((i) => (i - 1 + commands.length) % commands.length);
		} else if (event.key === "Home") {
			event.preventDefault();
			setActiveIndex(0);
		} else if (event.key === "End") {
			event.preventDefault();
			setActiveIndex(commands.length - 1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			commands[activeIndex]?.run();
		}
	}

	// Wraps each rendered row so it carries its global index, active state, and
	// the id the combobox points `aria-activedescendant` at.
	function row(commandId: string, onClick: () => void, children: ReactNode) {
		const index = commands.findIndex((c) => c.id === commandId);
		const active = index === activeIndex;
		return (
			<button
				type="button"
				id={`cp-cmd-${index}`}
				role="option"
				aria-selected={active}
				className={`command-palette-item${active ? " is-active" : ""}`}
				onClick={onClick}
				onMouseMove={() => {
					if (index !== activeIndex) setActiveIndex(index);
				}}
			>
				{children}
			</button>
		);
	}

	const activeId = commands.length > 0 ? `cp-cmd-${activeIndex}` : undefined;

	return (
		<div className="modal-root command-palette-root">
			<button
				type="button"
				className="modal-backdrop"
				aria-label="Close command palette"
				onClick={onClose}
			/>
			<div
				className="command-palette"
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
			>
				<label className="command-palette-search">
					<MagnifyingGlassIcon size={16} aria-hidden />
					<span className="sr-only">Search commands, views, and accounts</span>
					<input
						ref={inputRef}
						className="input"
						value={query}
						role="combobox"
						aria-expanded
						aria-controls="command-palette-listbox"
						aria-activedescendant={activeId}
						aria-autocomplete="list"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onKeyDown}
						placeholder="Search sections, views, or accounts…"
					/>
				</label>
				<div
					className="command-palette-list"
					id="command-palette-listbox"
					role="listbox"
					aria-label="Commands"
					ref={listRef}
				>
					{normalizedQuery.length === 0 && (
						<section>
							<h2>Current table</h2>
							{row(
								"table-search",
								focusTableSearch,
								<>
									<span>Focus table search</span>
									<kbd>/</kbd>
								</>,
							)}
						</section>
					)}
					{matchingSections.length > 0 && (
						<section>
							<h2>Navigate</h2>
							{matchingSections.map((section) =>
								row(
									`section-${section.key}`,
									() => navigate(section.key),
									section.label,
								),
							)}
						</section>
					)}
					{matchingViews.length > 0 && (
						<section>
							<h2>Saved views</h2>
							{matchingViews.map((view) =>
								row(
									`view-${view.id}`,
									() =>
										navigate(
											view.section,
											Object.fromEntries(new URLSearchParams(view.params)),
										),
									<>
										<span>{view.label}</span>
										<span className="dim">{view.section}</span>
									</>,
								),
							)}
						</section>
					)}
					{normalizedQuery.length > 0 && (
						<section>
							<h2>Accounts</h2>
							{searchingAccounts && (
								<div className="command-palette-empty">Searching accounts…</div>
							)}
							{accountError && (
								<div className="command-palette-empty result err">
									{accountError}
								</div>
							)}
							{!searchingAccounts && !accountError && accounts.length === 0 && (
								<div className="command-palette-empty">
									No matching verified accounts.
								</div>
							)}
							{accounts.map((account) =>
								row(
									`account-${account.id}`,
									() => navigate("users", { user: account.id }),
									<>
										<span>{account.label}</span>
										<span className="dim">
											{account.email ?? account.handle ?? account.id}
										</span>
									</>,
								),
							)}
						</section>
					)}
				</div>
			</div>
		</div>
	);
}
