import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { getJson } from "../lib/api";
import { noAutofill } from "../lib/form";
import type { AccountSearchResult } from "../lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Searchable picker over verified accounts with a synced library. Holds its own
// query/results; on pick it reports the field value (account id by default, or
// the email when `selectValue` asks for it) plus a human label for the caller.
//
// `allowRawEmail` lets the operator send to an address that isn't in the system
// (e.g. a test inbox): once the query looks like an email, it offers it as a
// pickable option.
export function AccountPicker({
	inputId,
	placeholder,
	value,
	label,
	onChange,
	allowRawEmail = false,
	selectValue = (r) => r.id,
}: {
	inputId: string;
	placeholder?: string;
	value: string;
	label: string | undefined;
	onChange: (
		value: string,
		label: string,
		account?: AccountSearchResult,
	) => void;
	allowRawEmail?: boolean;
	selectValue?: (r: AccountSearchResult) => string;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<AccountSearchResult[]>([]);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Debounced search; skipped once an account is selected. An empty query
	// returns the top verified users (server ranks by library size).
	useEffect(() => {
		if (value) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			setLoading(true);
			setError(null);
			getJson<{ accounts: AccountSearchResult[] }>(
				`/api/accounts/search?q=${encodeURIComponent(query.trim())}`,
			)
				.then((res) => {
					if (!cancelled) setResults(res.accounts);
				})
				.catch((e: unknown) => {
					// Surface failures instead of swallowing them into a misleading
					// "no users" state — a broken query should look broken.
					if (!cancelled) {
						setResults([]);
						setError(e instanceof Error ? e.message : String(e));
					}
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
		}, 200);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query, value]);

	if (value) {
		return (
			<div className="picker-selected">
				<span className="picker-selected-label">{label || value}</span>
				<button
					type="button"
					className="picker-clear"
					aria-label="Clear selection"
					onClick={() => {
						onChange("", "");
						setQuery("");
						setOpen(true);
					}}
				>
					<XIcon size={13} weight="bold" />
				</button>
			</div>
		);
	}

	const trimmed = query.trim();
	const rawEmailOption =
		allowRawEmail && EMAIL_RE.test(trimmed) ? trimmed : null;

	return (
		<div className="picker">
			<div className="picker-input">
				<MagnifyingGlassIcon size={14} className="picker-input-icon" />
				<input
					id={inputId}
					className="input"
					style={{ paddingLeft: 30 }}
					placeholder={placeholder}
					value={query}
					{...noAutofill}
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
					}}
					onFocusCapture={() => setOpen(true)}
					onBlur={() => setTimeout(() => setOpen(false), 150)}
				/>
			</div>
			{open && (
				<ul className="picker-menu">
					{loading && <li className="picker-empty">Searching…</li>}
					{!loading && error && (
						<li className="picker-empty picker-error">{error}</li>
					)}
					{rawEmailOption && (
						<li>
							<button
								type="button"
								className="picker-option"
								onClick={() => {
									onChange(rawEmailOption, rawEmailOption);
									setOpen(false);
								}}
							>
								<span className="picker-option-main">
									<span className="picker-option-label">
										Send to {rawEmailOption}
									</span>
									<span className="picker-option-sub">
										Address not in Hearted
									</span>
								</span>
							</button>
						</li>
					)}
					{!loading && !error && results.length === 0 && !rawEmailOption && (
						<li className="picker-empty">
							No verified users with a synced library.
						</li>
					)}
					{!loading &&
						!error &&
						results.map((r) => (
							<li key={r.id}>
								<button
									type="button"
									className="picker-option"
									onClick={() => {
										onChange(selectValue(r), r.label, r);
										setOpen(false);
									}}
								>
									<span className="picker-option-main">
										<span className="picker-option-label">{r.label}</span>
										{r.email && r.email !== r.label && (
											<span className="picker-option-sub">{r.email}</span>
										)}
									</span>
									<span className="picker-option-count">
										{r.activeLiked.toLocaleString()} liked
									</span>
								</button>
							</li>
						))}
				</ul>
			)}
		</div>
	);
}
