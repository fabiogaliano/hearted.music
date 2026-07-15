import {
	ArrowLeftIcon,
	ArrowsClockwiseIcon,
	CalendarBlankIcon,
	ClockCounterClockwiseIcon,
	CreditCardIcon,
	EnvelopeSimpleIcon,
	GaugeIcon,
	HeartIcon,
	type Icon,
	MicrophoneStageIcon,
	PulseIcon,
	SparkleIcon,
	TerminalWindowIcon,
	UsersIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { BatchProgressDrawer } from "./components/BatchProgressDrawer";
import { CommandPalette } from "./components/CommandPalette";
import { SavedViewsMenu } from "./components/SavedViewsMenu";
import { invalidateApiCache, useApi } from "./lib/api";
import { isModalOpen } from "./lib/modal-open";
import { NavContext } from "./lib/navigation";
import {
	canonicalUrl,
	parseUrlState,
	type SectionKey,
	sameUrl,
} from "./lib/url-state";
import {
	type AccountListQuery,
	SelectUserContext,
	ShowAccountsContext,
} from "./lib/user-selection";
import { AccountList } from "./sections/AccountList";
import { AudioReviewSection } from "./sections/AudioReviewSection";
import { BillingSection } from "./sections/BillingSection";
import { EmailSection } from "./sections/EmailSection";
import { EnrichmentSection } from "./sections/EnrichmentSection";
import { HistorySection } from "./sections/HistorySection";
import { InstrumentalReviewSection } from "./sections/InstrumentalReviewSection";
import { JobsSection } from "./sections/JobsSection";
import { LibrarySection } from "./sections/LibrarySection";
import { LyricsReviewSection } from "./sections/LyricsReviewSection";
import { OperationsSection } from "./sections/OperationsSection";
import { Overview } from "./sections/Overview";
import { ReleaseYearSection } from "./sections/ReleaseYearSection";
import { UserDetail } from "./sections/UserDetail";
import { UsersSection } from "./sections/UsersSection";

interface NavEntry {
	key: SectionKey;
	label: string;
	icon: Icon;
	render: (refreshKey: number) => ReactElement;
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.tagName === "SELECT" ||
		target.isContentEditable
	);
}

function formatUpdated(ageMs: number): string {
	const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
	if (ageSeconds < 10) return "just now";
	if (ageSeconds < 60) return `${ageSeconds}s ago`;
	const ageMinutes = Math.floor(ageSeconds / 60);
	if (ageMinutes < 60) return `${ageMinutes}m ago`;
	return `${Math.floor(ageMinutes / 60)}h ago`;
}

const NAV: NavEntry[] = [
	{
		key: "overview",
		label: "Overview",
		icon: GaugeIcon,
		render: (k) => <Overview refreshKey={k} />,
	},
	{
		key: "users",
		label: "Users",
		icon: UsersIcon,
		render: (k) => <UsersSection refreshKey={k} />,
	},
	{
		key: "library",
		label: "Library",
		icon: HeartIcon,
		render: (k) => <LibrarySection refreshKey={k} />,
	},
	{
		key: "enrichment",
		label: "Enrichment",
		icon: SparkleIcon,
		render: (k) => <EnrichmentSection refreshKey={k} />,
	},
	{
		key: "jobs",
		label: "Job health",
		icon: PulseIcon,
		render: (k) => <JobsSection refreshKey={k} />,
	},
	{
		key: "billing",
		label: "Billing & grants",
		icon: CreditCardIcon,
		render: (k) => <BillingSection refreshKey={k} />,
	},
	{
		key: "operations",
		label: "Operations",
		icon: TerminalWindowIcon,
		render: (k) => <OperationsSection refreshKey={k} />,
	},
	{
		key: "audio-review",
		label: "Audio review",
		icon: WaveformIcon,
		render: (k) => <AudioReviewSection refreshKey={k} />,
	},
	{
		key: "release-year",
		label: "Release year",
		icon: CalendarBlankIcon,
		render: (k) => <ReleaseYearSection refreshKey={k} />,
	},
	{
		key: "lyrics-review",
		label: "Lyrics review",
		icon: MicrophoneStageIcon,
		render: (k) => <LyricsReviewSection refreshKey={k} />,
	},
	{
		key: "instrumental-review",
		label: "Instrumental review",
		icon: WaveformIcon,
		render: (k) => <InstrumentalReviewSection refreshKey={k} />,
	},
	{
		key: "email",
		label: "Send email",
		icon: EnvelopeSimpleIcon,
		render: () => <EmailSection />,
	},
	{
		key: "history",
		label: "Action history",
		icon: ClockCounterClockwiseIcon,
		render: (k) => <HistorySection refreshKey={k} />,
	},
];

export function App() {
	const [refreshKey, setRefreshKey] = useState(0);
	const [url, setUrl] = useState(() =>
		canonicalUrl(new URL(window.location.href)),
	);
	const [now, setNow] = useState(() => Date.now());
	const [paletteOpen, setPaletteOpen] = useState(false);
	const previousRef = useRef<string | null>(null);
	const health = useApi<{ ref: string }>("/api/health");
	const location = parseUrlState(url);
	const active: SectionKey = location.section;
	const userId = location.userId;
	const tier =
		location.tierMin === null
			? null
			: ({
					title: "Library accounts",
					minLiked: location.tierMin,
					maxLiked: location.tierMax,
				} satisfies AccountListQuery);

	useEffect(() => {
		const initial = canonicalUrl(new URL(window.location.href));
		if (!sameUrl(initial, new URL(window.location.href))) {
			window.history.replaceState({ controlPanel: true }, "", initial);
		}
		window.history.replaceState({ controlPanel: true }, "", initial);
		setUrl(initial);
		const onPopState = () => {
			const next = canonicalUrl(new URL(window.location.href));
			if (!sameUrl(next, new URL(window.location.href))) {
				window.history.replaceState({ controlPanel: true }, "", next);
			}
			setUrl(next);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (
				event.key.toLowerCase() !== "k" ||
				(!event.metaKey && !event.ctrlKey)
			) {
				return;
			}
			if (isTypingTarget(event.target)) return;
			if (paletteOpen) {
				event.preventDefault();
				setPaletteOpen(false);
				return;
			}
			if (isModalOpen()) return;
			event.preventDefault();
			setPaletteOpen(true);
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [paletteOpen]);

	useEffect(() => {
		if (!health.data?.ref) return;
		if (previousRef.current && previousRef.current !== health.data.ref) {
			invalidateApiCache();
		}
		previousRef.current = health.data.ref;
	}, [health.data?.ref]);

	function commitUrl(next: URL, replace = false, overlay = false) {
		const canonical = canonicalUrl(next);
		window.history[replace ? "replaceState" : "pushState"](
			{ controlPanel: true, overlay },
			"",
			canonical,
		);
		setUrl(canonical);
	}

	function go(key: SectionKey, params?: Record<string, string>) {
		const next = new URL(window.location.href);
		next.search = "";
		next.searchParams.set("section", key);
		for (const [name, value] of Object.entries(params ?? {})) {
			next.searchParams.set(name, value);
		}
		commitUrl(next);
	}

	// Opening a user from inside a tier list keeps the source URL so Back restores it.
	function selectUser(id: string | null) {
		if (id === null) {
			back();
			return;
		}
		const next = new URL(window.location.href);
		next.searchParams.set("user", id);
		commitUrl(next, false, true);
	}

	function showAccounts(query: AccountListQuery | null) {
		if (query === null) return;
		const next = new URL(window.location.href);
		next.search = "";
		next.searchParams.set("section", "library");
		next.searchParams.set("tierMin", String(query.minLiked));
		if (query.maxLiked !== null)
			next.searchParams.set("tierMax", String(query.maxLiked));
		commitUrl(next, false, true);
	}

	const overlayTitle = userId ? "User detail" : tier ? tier.title : null;
	function back() {
		if (window.history.state?.controlPanel && window.history.state.overlay)
			window.history.back();
		else {
			const next = new URL(window.location.href);
			next.searchParams.delete("user");
			next.searchParams.delete("tierMin");
			next.searchParams.delete("tierMax");
			commitUrl(next, true);
		}
	}

	const entry = NAV.find((n) => n.key === active) ?? NAV[0];
	const updated =
		health.fetchedAt === null ? null : formatUpdated(now - health.fetchedAt);

	function focusCurrentTableSearch() {
		document
			.querySelector<HTMLInputElement>(".content .data-table-search input")
			?.focus();
	}

	return (
		<NavContext.Provider value={go}>
			<SelectUserContext.Provider value={selectUser}>
				<ShowAccountsContext.Provider value={showAccounts}>
					<div className="app">
						<aside className="sidebar">
							<div className="brand">
								<span className="brand-mark">
									<HeartIcon size={15} weight="fill" />
								</span>
								<div>
									<div className="brand-name">Hearted</div>
									<div className="brand-sub">CONTROL PANEL</div>
								</div>
							</div>

							<div className="nav-label">Metrics</div>
							{NAV.slice(0, 6).map((n) => (
								<button
									type="button"
									key={n.key}
									className={`nav-item ${active === n.key && !overlayTitle ? "active" : ""}`}
									onClick={() => go(n.key)}
								>
									<n.icon
										size={16}
										weight={active === n.key ? "fill" : "regular"}
									/>
									{n.label}
								</button>
							))}

							<div className="nav-label">Actions</div>
							{NAV.slice(6).map((n) => (
								<button
									type="button"
									key={n.key}
									className={`nav-item ${active === n.key && !overlayTitle ? "active" : ""}`}
									onClick={() => go(n.key)}
								>
									<n.icon
										size={16}
										weight={active === n.key ? "fill" : "regular"}
									/>
									{n.label}
								</button>
							))}

							<div className="sidebar-footer">
								<span className="prod-pill">
									<span className="prod-dot" />
									prod · {health.data?.ref ?? "connecting…"}
								</span>
							</div>
						</aside>

						<main className="main">
							<div className="topbar">
								{overlayTitle ? (
									<>
										<button
											type="button"
											className="icon-btn"
											title="Back"
											onClick={back}
										>
											<ArrowLeftIcon size={15} weight="bold" />
										</button>
										<h1>{overlayTitle}</h1>
									</>
								) : (
									<h1>{entry.label}</h1>
								)}
								<div className="spacer" />
								{updated && <span className="updated">Updated {updated}</span>}
								{health.refreshing && (
									<span className="refreshing">Refreshing…</span>
								)}
								{!overlayTitle && <SavedViewsMenu />}
								<button
									type="button"
									className="btn command-palette-trigger"
									title="Open command palette (Cmd/Ctrl+K)"
									onClick={() => setPaletteOpen(true)}
								>
									⌘ K
								</button>
								<button
									type="button"
									className="icon-btn"
									title="Refresh all"
									onClick={() => setRefreshKey((k) => k + 1)}
								>
									<ArrowsClockwiseIcon size={15} weight="bold" />
								</button>
							</div>
							<div className="content">
								{userId ? (
									<UserDetail accountId={userId} />
								) : tier ? (
									<AccountList query={tier} />
								) : (
									entry.render(refreshKey)
								)}
							</div>
						</main>
						<BatchProgressDrawer />
						{paletteOpen && (
							<CommandPalette
								sections={NAV.map(({ key, label }) => ({ key, label }))}
								onNavigate={go}
								onClose={() => setPaletteOpen(false)}
								onFocusTableSearch={focusCurrentTableSearch}
							/>
						)}
					</div>
				</ShowAccountsContext.Provider>
			</SelectUserContext.Provider>
		</NavContext.Provider>
	);
}
