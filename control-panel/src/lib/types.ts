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
}
