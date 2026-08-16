export type PageSize = 25 | 50 | 100;

export interface PageResult<T> {
	rows: T[];
	total: number;
	page: number;
	pageSize: PageSize;
}

// Mirrors the server metric shapes (control-panel/server/metrics.ts). Kept
// separate so the UI bundle never imports the server's runtime deps.

export interface UsersMetrics {
	totalAccounts: number;
	signups1d: number;
	signups7d: number;
	signups30d: number;
	accountsWithLibrary: number;
	accountsWithoutLibrary: number;
	waitlistTotal: number;
	signupTrend: { day: string; count: number }[];
}

export interface LibraryMetrics {
	activeLiked: number;
	distinctLibrarySongs: number;
	totalPlaylists: number;
	totalSongs: number;
	distribution: {
		bucket: string;
		accounts: number;
		min: number;
		max: number | null;
	}[];
	topUsers: {
		id: string;
		label: string;
		handle: string | null;
		liked: number;
		playlists: number;
	}[];
}

export interface UserRow {
	id: string;
	label: string;
	handle: string | null;
	email: string | null;
	emailVerified: boolean;
	createdAt: string;
	lastSeenAt: string | null;
	onboardingStep: string | null;
	onboarded: boolean;
	liked: number;
	playlists: number;
	unlocks: number;
	plan: string | null;
	unlimited: boolean;
}

export interface AccountLikedRow {
	id: string;
	label: string;
	handle: string | null;
	email: string | null;
	liked: number;
	playlists: number;
	createdAt: string;
}

export interface EnrichmentMetrics {
	entitledSongs: number;
	missingAudio: number;
	missingLyrics: number;
	missingAnalysis: number;
	missingEmbedding: number;
	analysisCount: number;
	analysisCostUsd: number;
	gapsByUser: {
		id: string;
		label: string;
		handle: string | null;
		entitledSongs: number;
		missingAudio: number;
		missingLyrics: number;
		missingAnalysis: number;
		missingEmbedding: number;
	}[];
}

export interface EnrichmentAccountRow {
	id: string;
	label: string;
	handle: string | null;
	entitledSongs: number;
	missingAudio: number;
	missingLyrics: number;
	missingAnalysis: number;
	missingEmbedding: number;
	coverage: number;
}

export interface GrantRow {
	id: string;
	accountId: string;
	accountLabel: string;
	origin: string;
	createdAt: string;
	appliedAt: string | null;
	requestedBy: string | null;
	note: string | null;
	status: "pending" | "applied";
}

export interface SubscriptionRow {
	accountId: string;
	accountLabel: string;
	plan: string | null;
	status: string;
	unlimitedSource: string | null;
	periodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	creditBalance: number;
	syntheticGift: boolean;
}

export interface JobFailureItem {
	id: string;
	itemType: string;
	itemId: string;
	itemLabel: string;
	failureCode: string;
	stage: string | null;
	errorMessage: string | null;
	isTerminal: boolean;
	createdAt: string;
	accountId: string | null;
	accountLabel: string | null;
	accountHandle: string | null;
}

export interface JobRunRow {
	id: string;
	accountId: string;
	accountLabel: string;
	accountHandle: string | null;
	type: string;
	status: string;
	progress: Record<string, unknown> | null;
	error: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
	heartbeatAt: string | null;
	stale: boolean;
}

export interface UserSong {
	songId: string;
	name: string;
	artist: string;
	imageUrl: string | null;
	likedAt: string;
	unlocked: boolean;
	hasAudio: boolean;
	hasLyrics: boolean;
	hasAnalysis: boolean;
	hasEmbedding: boolean;
}

export interface UserDetail {
	id: string;
	email: string | null;
	handle: string | null;
	displayName: string | null;
	spotifyId: string | null;
	imageUrl: string | null;
	createdAt: string;
	plan: string | null;
	subscriptionStatus: string | null;
	unlimitedAccessSource: string | null;
	creditBalance: number;
	activeLiked: number;
	totalLikedEver: number;
	playlists: number;
	activeUnlocks: number;
	revokedUnlocks: number;
	entitledSongs: number;
	missingAudio: number;
	missingLyrics: number;
	missingAnalysis: number;
	missingEmbedding: number;
	grant: {
		origin: string;
		appliedAt: string | null;
		requestedBy: string | null;
		note: string | null;
	} | null;
	songs: UserSong[];
}

export interface JobMetrics {
	pending: number;
	running: number;
	failed: number;
	completed: number;
	staleRunning: number;
	unresolvedFailures: number;
	parkedFailures: number;
	oldestPendingSeconds: number | null;
	byType: { type: string; pending: number; running: number; failed: number }[];
	recentFailures: {
		id: string;
		type: string;
		error: string | null;
		updatedAt: string;
	}[];
	failureCodes: { code: string; count: number }[];
}

export type OverviewRange = "24h" | "7d" | "14d" | "30d";

export interface RangeComparison {
	current: number;
	previous: number;
	deltaAbsolute: number;
	deltaPercent: number | null;
}

export interface OverviewComparisons {
	range: OverviewRange;
	signups: RangeComparison;
	jobsCreated: RangeComparison;
	jobsCompleted: RangeComparison;
	jobsFailed: RangeComparison;
	analysesCreated: RangeComparison;
	analysisSpendUsd: RangeComparison;
}

export interface BillingMetrics {
	activeSubscriptions: number;
	creditBalanceTotal: number;
	plans: { plan: string; status: string; accounts: number }[];
	grants: {
		total: number;
		applied: number;
		pending: number;
		byOrigin: { origin: string; applied: number; pending: number }[];
	};
}

export interface OperationField {
	name: string;
	label: string;
	type: "select" | "text" | "number" | "account";
	required?: boolean;
	placeholder?: string;
	options?: { value: string; label: string }[];
	default?: string;
	min?: number;
	max?: number;
	visibleWhen?: { field: string; equals: string };
}

export interface AccountSearchResult {
	id: string;
	label: string;
	email: string | null;
	handle: string | null;
	activeLiked: number;
}

export interface OperationDef {
	id: string;
	title: string;
	description: string;
	danger: boolean;
	supportsDryRun: boolean;
	fields: OperationField[];
}

export interface OperationResult {
	ok: boolean;
	status: string;
	message: string;
	details?: Record<string, unknown>;
	// Present on a commit response: the local action_run id, for a history link.
	runId?: string | null;
}

// Mirrors control-panel/server/operation-preview.ts. Structured impact rows the
// Operations preview renders directly; raw facts stay behind a Debug disclosure.
export type PreviewRowKind =
	| "identity"
	| "current"
	| "change"
	| "skip"
	| "downstream"
	| "warning";

export type PreviewTone = "default" | "warning" | "danger" | "success";

export interface OperationPreviewRow {
	kind: PreviewRowKind;
	label: string;
	value: string;
	tone?: PreviewTone;
}

export interface OperationPreview {
	action: string;
	title: string;
	targetLabel: string;
	targetId: string | null;
	willChange: boolean;
	rows: OperationPreviewRow[];
	raw: Record<string, unknown>;
}

export interface OperationPreviewResponse {
	previewId: string | null;
	expiresAt: string | null;
	preview: OperationPreview;
}

// Mirrors control-panel/server/local-store/action-runs.ts. The local action
// history is for operator recall/recovery, not an authoritative audit record.
export type ActionRunMode = "dry_run" | "commit";
export type ActionRunStatus =
	| "started"
	| "succeeded"
	| "failed"
	| "partial"
	| "interrupted";

export interface ActionRunRow {
	id: string;
	prodRef: string;
	actionType: string;
	mode: ActionRunMode;
	targetType: string | null;
	targetId: string | null;
	targetLabel: string | null;
	inputSummary: Record<string, unknown> | null;
	status: ActionRunStatus;
	resultSummary: Record<string, unknown> | null;
	errorMessage: string | null;
	externalId: string | null;
	startedAt: string;
	completedAt: string | null;
	parentRunId: string | null;
}

export interface ActionRunTodaySummary {
	commits: number;
	dryRuns: number;
	failedOrPartial: number;
}

export type TelemetryPreset = "24h" | "7d" | "14d" | "30d" | "90d" | "launch";

export type TelemetrySourceStatus =
	| { status: "available"; fetchedAt: string; latestObservedAt: string | null }
	| { status: "quiet"; fetchedAt: string; latestObservedAt: string | null }
	| { status: "unconfigured"; message: string }
	| { status: "unavailable"; message: string };

export interface TelemetryEnvelope<T> {
	generatedAt: string;
	range: {
		from: string;
		to: string;
		timezone: "UTC";
		preset: string;
	};
	data: T;
	sources: {
		supabase: TelemetrySourceStatus;
		posthog: TelemetrySourceStatus;
	};
	caveats: string[];
}

export interface TelemetrySummaryData {
	accountsCreated: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	activatedAccounts: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	current7DayActive: number;
	engagedMatchingAccounts: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	paidAccounts: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	llmSpend: {
		currentCostUsd: number;
		previousCostUsd: number;
		deltaPercent: number | null;
	};
}

export interface FunnelStageMetric {
	stageId: string;
	name: string;
	count: number;
	conversionFromPrevious: number | null;
	conversionFromSignup: number | null;
	medianSeconds: number | null;
	p75Seconds: number | null;
	stuckCount: number;
	limitationNote?: string;
}

export interface FunnelCohortReport {
	cohortRange: { from: string; to: string };
	totalSignups: number;
	hasSufficientData: boolean;
	stages: FunnelStageMetric[];
}

export interface TelemetryActivityData {
	dailyActive: { date: string; count: number | null; isComplete: boolean }[];
	current24hActive: number;
	currentWau: number;
	currentMau: number;
	cohortRetention: {
		cohortWeek: string;
		signups: number;
		week1Active: number | null;
		week1Rate: number | null;
		week4Active: number | null;
		week4Rate: number | null;
		isWeek1Mature: boolean;
		isWeek4Mature: boolean;
	}[];
	observedWebActivity: {
		visitors: number | null;
		pageviews: number | null;
		sessions: number | null;
		latestObservedAt: string | null;
	};
	routeUsage: { pathname: string; count: number }[];
}

export interface TelemetryEngagementData {
	sessionsStarted: number;
	sessionsCompleted: number;
	suggestionsServed: number;
	added: number;
	dismissed: number;
	skipped: number;
	totalDecisions: number;
	engagedAccounts: number;
	matchSessions: number;
	explicitDecisionAddRate: number | null;
	servedAddRate: number | null;
	decisionsPerAccount: number | null;
	orientationSplit: {
		song: number;
		playlist: number;
	};
	timeToFirstDecisionSeconds: number | null;
	timeToFirstAddSeconds: number | null;
}

export interface TelemetryEconomicsData {
	totalCostUsd: number;
	totalCalls: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	previousPeriodCostUsd: number;
	costDeltaPercent: number | null;
	byFunction: {
		functionId: string;
		calls: number;
		costUsd: number;
		inputTokens: number;
		outputTokens: number;
	}[];
	byModel: {
		model: string;
		calls: number;
		costUsd: number;
	}[];
	byProvider: {
		provider: string;
		calls: number;
		costUsd: number;
	}[];
	dailySpend: {
		date: string;
		costUsd: number;
		calls: number;
	}[];
	costPerAnalyzedSong: number | null;
	costPerActivatedAccount: number | null;
	costPerPaidAccount: number | null;
	activeSubscriptions: number;
	newPaidActivations: number;
	previousPaidActivations: number;
}

export interface EventCoverageRow {
	id: string;
	name: string;
	canonicalSource: string;
	posthogEventName: string;
	dbCount: number;
	posthogCount: number | null;
	dbDistinctAccounts: number;
	posthogDistinctAccounts: number | null;
	coveragePercent: number | null;
	dbLatestTimestamp: string | null;
	posthogLatestTimestamp: string | null;
	isLowVolume: boolean;
	semanticNote: string;
}

export interface TelemetryCoverageData {
	rows: EventCoverageRow[];
	freshness: {
		dbLatest: string | null;
		posthogLatest: string | null;
	};
}
