import {
	ArrowLeftIcon,
	ArrowsClockwiseIcon,
	CreditCardIcon,
	EnvelopeSimpleIcon,
	GaugeIcon,
	HeartIcon,
	type Icon,
	PulseIcon,
	SparkleIcon,
	TerminalWindowIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import { type ReactElement, useState } from "react";
import { useApi } from "./lib/api";
import { NavContext } from "./lib/navigation";
import {
	type AccountListQuery,
	SelectUserContext,
	ShowAccountsContext,
} from "./lib/user-selection";
import { AccountList } from "./sections/AccountList";
import { BillingSection } from "./sections/BillingSection";
import { EmailSection } from "./sections/EmailSection";
import { EnrichmentSection } from "./sections/EnrichmentSection";
import { JobsSection } from "./sections/JobsSection";
import { LibrarySection } from "./sections/LibrarySection";
import { OperationsSection } from "./sections/OperationsSection";
import { Overview } from "./sections/Overview";
import { UserDetail } from "./sections/UserDetail";
import { UsersSection } from "./sections/UsersSection";

interface NavEntry {
	key: string;
	label: string;
	icon: Icon;
	render: (refreshKey: number) => ReactElement;
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
		key: "email",
		label: "Send email",
		icon: EnvelopeSimpleIcon,
		render: () => <EmailSection />,
	},
];

export function App() {
	const [active, setActive] = useState("overview");
	const [refreshKey, setRefreshKey] = useState(0);
	const [userId, setUserId] = useState<string | null>(null);
	const [tier, setTier] = useState<AccountListQuery | null>(null);
	const health = useApi<{ ref: string }>("/api/health");

	const entry = NAV.find((n) => n.key === active) ?? NAV[0];

	function go(key: string) {
		setUserId(null);
		setTier(null);
		setActive(key);
	}

	// Opening a user from inside a tier list keeps the tier so Back returns to it.
	function selectUser(id: string | null) {
		setUserId(id);
	}

	function showAccounts(query: AccountListQuery | null) {
		setUserId(null);
		setTier(query);
	}

	const overlayTitle = userId ? "User detail" : tier ? tier.title : null;
	function back() {
		if (userId) setUserId(null);
		else setTier(null);
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
								{/* key forces a fresh mount so entrance animations replay */}
								{userId ? (
									<div key={`user-${userId}`}>
										<UserDetail accountId={userId} />
									</div>
								) : tier ? (
									<div key={`tier-${tier.minLiked}-${tier.maxLiked}`}>
										<AccountList query={tier} />
									</div>
								) : (
									<div key={`${entry.key}-${refreshKey}`}>
										{entry.render(refreshKey)}
									</div>
								)}
							</div>
						</main>
					</div>
				</ShowAccountsContext.Provider>
			</SelectUserContext.Provider>
		</NavContext.Provider>
	);
}
