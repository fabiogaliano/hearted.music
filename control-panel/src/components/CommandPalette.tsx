import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { getJson } from "../lib/api";
import { isModalOpen, registerOpenModal } from "../lib/modal-open";
import { listSavedViews, type SavedView } from "../lib/saved-views";
import type { AccountSearchResult } from "../lib/types";
import type { SectionKey } from "../lib/url-state";

export interface CommandPaletteSection {
	key: SectionKey;
	label: string;
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
	const [query, setQuery] = useState("");
	const [accounts, setAccounts] = useState<AccountSearchResult[]>([]);
	const [accountError, setAccountError] = useState<string | null>(null);
	const [searchingAccounts, setSearchingAccounts] = useState(false);
	const [savedViews] = useState<SavedView[]>(listSavedViews);

	useEffect(() => {
		const unregister = registerOpenModal();
		inputRef.current?.focus();
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

	function openView(view: SavedView) {
		navigate(
			view.section,
			Object.fromEntries(new URLSearchParams(view.params)),
		);
	}

	function openAccount(account: AccountSearchResult) {
		navigate("users", { user: account.id });
	}

	function focusTableSearch() {
		if (isModalOpen()) {
			onClose();
			window.requestAnimationFrame(onFocusTableSearch);
		}
	}

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
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search sections, views, or accounts…"
					/>
				</label>
				<div className="command-palette-list">
					{normalizedQuery.length === 0 && (
						<section>
							<h2>Current table</h2>
							<button
								type="button"
								className="command-palette-item"
								onClick={focusTableSearch}
							>
								<span>Focus table search</span>
								<kbd>/</kbd>
							</button>
						</section>
					)}
					{matchingSections.length > 0 && (
						<section>
							<h2>Navigate</h2>
							{matchingSections.map((section) => (
								<button
									key={section.key}
									type="button"
									className="command-palette-item"
									onClick={() => navigate(section.key)}
								>
									{section.label}
								</button>
							))}
						</section>
					)}
					{matchingViews.length > 0 && (
						<section>
							<h2>Saved views</h2>
							{matchingViews.map((view) => (
								<button
									key={view.id}
									type="button"
									className="command-palette-item"
									onClick={() => openView(view)}
								>
									<span>{view.label}</span>
									<span className="dim">{view.section}</span>
								</button>
							))}
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
							{accounts.map((account) => (
								<button
									key={account.id}
									type="button"
									className="command-palette-item"
									onClick={() => openAccount(account)}
								>
									<span>{account.label}</span>
									<span className="dim">
										{account.email ?? account.handle ?? account.id}
									</span>
								</button>
							))}
						</section>
					)}
				</div>
			</div>
		</div>
	);
}
