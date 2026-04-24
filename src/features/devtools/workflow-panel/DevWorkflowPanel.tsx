import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { PaneRoot, PaneStore, useActiveTab, usePane } from "uipane";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import { WORKFLOW_PRESETS } from "@/features/devtools/workflow-panel/presets";
import { useWorkflowDevSettings } from "@/features/devtools/workflow-panel/useWorkflowDevSettings";
import { useLibraryProcessingJobProgress } from "@/lib/hooks/useLibraryProcessingJobProgress";
import {
	type GuidedWorkflowState,
	getGuidedWorkflowState,
	type RunUntilIdleResult,
	resetLibraryProcessingWarmReplay,
	resetMatchSnapshotReplay,
	runLibraryProcessingUntilIdle,
	type StepResult,
	stepLibraryProcessing,
} from "@/lib/server/dev-workflow.functions";
import type { LibraryProcessingJobProgress } from "@/lib/server/jobs.functions";
import { ENRICHMENT_STAGE_NAMES } from "@/lib/platform/jobs/progress/enrichment";
import { MATCH_REFRESH_STAGE_NAMES } from "@/lib/platform/jobs/progress/match-snapshot-refresh";
import type { StageStatus } from "@/lib/platform/jobs/progress/base";
import {
	DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS,
	DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS,
	type WorkflowDevClientSettings,
	type WorkflowDevServerSettings,
} from "@/lib/workflows/library-processing/devtools/settings";
import type { OnboardingStep } from "@/lib/domains/library/accounts/preferences-queries";
import type { OnboardingAuthPayload } from "@/lib/server/onboarding.functions";
import {
	getOnboardingSession,
	saveOnboardingStep,
} from "@/lib/server/onboarding.functions";
import { resolveSession } from "@/features/onboarding/step-resolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPanelId(name: string): string | null {
	return PaneStore.getPanels().find((p) => p.name === name)?.id ?? null;
}

function updatePaneValue(panelName: string, path: string, value: number): void {
	const id = getPanelId(panelName);
	if (id) PaneStore.updateValue(id, path, value);
}

function formatStage(s: string | null | undefined): string {
	if (!s) return "waiting";
	return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortId(id: string | null | undefined): string {
	return id ? `${id.slice(0, 8)}…` : "—";
}

function statusColor(s: StageStatus | "idle" | "active"): string {
	switch (s) {
		case "running":
		case "active":
			return "#fde68a";
		case "completed":
			return "#86efac";
		case "failed":
			return "#fca5a5";
		case "skipped":
			return "#c4b5fd";
		default:
			return "#737373";
	}
}

function applyPreset(
	presetId: string,
	updateClient: (p: Partial<WorkflowDevClientSettings>) => void,
	updateServer: (p: Partial<WorkflowDevServerSettings>) => void,
	setLastAction: (m: string) => void,
): void {
	const preset = WORKFLOW_PRESETS.find((p) => p.id === presetId);
	if (!preset) return;

	updatePaneValue(
		"Enrichment",
		"stageDelay",
		preset.server.enrichmentStageDelayMs,
	);
	updatePaneValue(
		"Matching",
		"refreshStageDelay",
		preset.server.refreshStageDelayMs,
	);
	updatePaneValue(
		"Matching",
		"preSettlementDelay",
		preset.server.preSettlementDelayMs,
	);
	updatePaneValue(
		"Settings",
		"polling.activeJobsPollMs",
		preset.client.activeJobsPollMs,
	);
	updatePaneValue(
		"Settings",
		"polling.jobProgressPollMs",
		preset.client.jobProgressPollMs,
	);
	updatePaneValue(
		"Settings",
		"limits.runUntilIdleMaxJobs",
		preset.server.runUntilIdleMaxJobs,
	);

	updateClient(preset.client);
	updateServer(preset.server);
	setLastAction(`Loaded ${preset.name.toLowerCase()} preset`);
}

// ---------------------------------------------------------------------------
// Onboarding step navigation
// ---------------------------------------------------------------------------

const ONBOARDING_STEPS: OnboardingStep[] = [
	"welcome",
	"pick-color",
	"install-extension",
	"syncing",
	"flag-playlists",
	"pick-demo-song",
	"song-walkthrough",
	"match-walkthrough",
	"plan-selection",
	"complete",
];

const ONBOARDING_SESSION_QUERY_KEY = ["auth", "onboarding-session"] as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DevWorkflowPanel() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const { client, server, updateClient, updateServer, resetAll } =
		useWorkflowDevSettings();
	const [wfState, setWfState] = useState<GuidedWorkflowState | null>(null);
	const [lastAction, setLastAction] = useState("");
	const [isRunning, setIsRunning] = useState(false);

	const activeTab = useActiveTab();

	// ---- Tab 1: Enrichment ----
	const enrichParams = usePane(
		"Enrichment",
		{
			stageDelay: {
				type: "slider",
				value: server.enrichmentStageDelayMs,
				min: 0,
				max: 5_000,
				step: 100,
			},
			resetWarmReplay: { type: "action", label: "Reset & Replay All" },
		},
		{
			onAction: (path) => {
				if (path === "resetWarmReplay") void handleWarmReplayReset();
			},
		},
	);

	// ---- Tab 2: Matching ----
	const matchParams = usePane(
		"Matching",
		{
			refreshStageDelay: {
				type: "slider",
				value: server.refreshStageDelayMs,
				min: 0,
				max: 5_000,
				step: 100,
			},
			preSettlementDelay: {
				type: "slider",
				value: server.preSettlementDelayMs,
				min: 0,
				max: 3_000,
				step: 100,
			},
			resetMatchOnly: { type: "action", label: "Reset Match Snapshot" },
		},
		{
			onAction: (path) => {
				if (path === "resetMatchOnly") void handleMatchOnlyReset();
			},
		},
	);

	// ---- Tab 3: Settings ----
	const settingsParams = usePane(
		"Settings",
		{
			polling: {
				type: "folder",
				open: true,
				children: {
					activeJobsPollMs: {
						type: "slider",
						value: client.activeJobsPollMs,
						min: 500,
						max: 15_000,
						step: 500,
					},
					jobProgressPollMs: {
						type: "slider",
						value: client.jobProgressPollMs,
						min: 500,
						max: 10_000,
						step: 500,
					},
				},
			},
			limits: {
				type: "folder",
				open: true,
				children: {
					runUntilIdleMaxJobs: {
						type: "slider",
						value: server.runUntilIdleMaxJobs,
						min: 1,
						max: 50,
						step: 1,
					},
				},
			},
			presets: {
				type: "folder",
				open: false,
				children: {
					fast: { type: "action", label: "Load Fast" },
					watchable: { type: "action", label: "Load Watchable" },
					slowMotion: { type: "action", label: "Load Slow Motion" },
					resetTuning: { type: "action", label: "Reset to Defaults" },
				},
			},
		},
		{
			onAction: (path) => {
				switch (path) {
					case "presets.fast":
						applyPreset("fast", updateClient, updateServer, setLastAction);
						break;
					case "presets.watchable":
						applyPreset("watchable", updateClient, updateServer, setLastAction);
						break;
					case "presets.slowMotion":
						applyPreset(
							"slow-motion",
							updateClient,
							updateServer,
							setLastAction,
						);
						break;
					case "presets.resetTuning": {
						updatePaneValue(
							"Enrichment",
							"stageDelay",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.enrichmentStageDelayMs,
						);
						updatePaneValue(
							"Matching",
							"refreshStageDelay",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.refreshStageDelayMs,
						);
						updatePaneValue(
							"Matching",
							"preSettlementDelay",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.preSettlementDelayMs,
						);
						updatePaneValue(
							"Settings",
							"polling.activeJobsPollMs",
							DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS.activeJobsPollMs,
						);
						updatePaneValue(
							"Settings",
							"polling.jobProgressPollMs",
							DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS.jobProgressPollMs,
						);
						updatePaneValue(
							"Settings",
							"limits.runUntilIdleMaxJobs",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.runUntilIdleMaxJobs,
						);
						resetAll();
						setLastAction("Reset all tuning to defaults");
						break;
					}
				}
			},
		},
	);

	// ---- Tab 4: Onboarding ----
	const onboardingParams = usePane(
		"Onboarding",
		{
			stepIndex: {
				type: "slider",
				value: 0,
				min: 0,
				max: ONBOARDING_STEPS.length - 1,
				step: 1,
			},
			goToStep: { type: "action", label: "Go to Step" },
			prev: { type: "action", label: "← Prev" },
			next: { type: "action", label: "Next →" },
		},
		{
			onAction: (path) => {
				switch (path) {
					case "goToStep":
						void handleOnboardingNav(
							ONBOARDING_STEPS[onboardingStepRef.current]!,
						);
						break;
					case "prev":
						void handleOnboardingNav("prev");
						break;
					case "next":
						void handleOnboardingNav("next");
						break;
				}
			},
		},
	);

	const onboardingStepRef = useRef(onboardingParams.stepIndex);
	useEffect(() => {
		onboardingStepRef.current = onboardingParams.stepIndex;
	}, [onboardingParams.stepIndex]);

	// ---- Sync settings ----
	useEffect(() => {
		updateClient({
			activeJobsPollMs: settingsParams.polling.activeJobsPollMs,
			jobProgressPollMs: settingsParams.polling.jobProgressPollMs,
		});
	}, [
		settingsParams.polling.activeJobsPollMs,
		settingsParams.polling.jobProgressPollMs,
		updateClient,
	]);

	useEffect(() => {
		updateServer({
			enrichmentStageDelayMs: enrichParams.stageDelay,
			refreshStageDelayMs: matchParams.refreshStageDelay,
			preSettlementDelayMs: matchParams.preSettlementDelay,
			runUntilIdleMaxJobs: settingsParams.limits.runUntilIdleMaxJobs,
		});
	}, [
		enrichParams.stageDelay,
		matchParams.refreshStageDelay,
		matchParams.preSettlementDelay,
		settingsParams.limits.runUntilIdleMaxJobs,
		updateServer,
	]);

	// ---- Polling ----
	const invalidateWorkflowQueries = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: ["active-jobs"] });
		void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
		void queryClient.invalidateQueries({ queryKey: ["matching"] });
		void queryClient.invalidateQueries({ queryKey: ["liked-songs"] });
		void queryClient.invalidateQueries({ queryKey: ["playlists"] });
	}, [queryClient]);

	const refreshState = useCallback(async (showMsg: boolean) => {
		try {
			const next = await getGuidedWorkflowState();
			setWfState(next);
			if (showMsg) setLastAction("Refreshed");
		} catch (error) {
			setLastAction(
				`Refresh error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}, []);

	useEffect(() => {
		void refreshState(false);
		const id = setInterval(
			() => void refreshState(false),
			settingsParams.polling.activeJobsPollMs,
		);
		return () => clearInterval(id);
	}, [refreshState, settingsParams.polling.activeJobsPollMs]);

	// ---- Composed settings for server calls ----
	const serverSettings = useMemo(
		() => ({
			enrichmentStageDelayMs: enrichParams.stageDelay,
			refreshStageDelayMs: matchParams.refreshStageDelay,
			preSettlementDelayMs: matchParams.preSettlementDelay,
			runUntilIdleMaxJobs: settingsParams.limits.runUntilIdleMaxJobs,
		}),
		[
			enrichParams.stageDelay,
			matchParams.refreshStageDelay,
			matchParams.preSettlementDelay,
			settingsParams.limits.runUntilIdleMaxJobs,
		],
	);

	// ---- Handlers ----
	const handleStep = useCallback(async () => {
		if (isRunning) return;
		setIsRunning(true);
		setLastAction("Running next queued job…");
		try {
			const r: StepResult = await stepLibraryProcessing({
				data: { settings: serverSettings },
			});
			setLastAction(
				r.stepped
					? `Ran ${r.jobType} → ${r.outcome?.status ?? "?"}`
					: "Queue empty",
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (e) {
			setLastAction(
				`Step error: ${e instanceof Error ? e.message : String(e)}`,
			);
		} finally {
			setIsRunning(false);
		}
	}, [serverSettings, invalidateWorkflowQueries, isRunning, refreshState]);

	const handleRunUntilIdle = useCallback(async () => {
		if (isRunning) return;
		setIsRunning(true);
		setLastAction("Draining queue…");
		try {
			const r: RunUntilIdleResult = await runLibraryProcessingUntilIdle({
				data: { settings: serverSettings },
			});
			const ok = r.outcomes.filter((o) => o.status === "completed").length;
			setLastAction(
				`Ran ${r.jobsRun} jobs (${ok} ok, ${r.outcomes.length - ok} failed) · ${r.stoppedReason}`,
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (e) {
			setLastAction(`Run error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setIsRunning(false);
		}
	}, [serverSettings, invalidateWorkflowQueries, isRunning, refreshState]);

	const handleWarmReplayReset = useCallback(async () => {
		if (isRunning) return;
		setIsRunning(true);
		setLastAction("Resetting enrichment + match state…");
		try {
			const r = await resetLibraryProcessingWarmReplay();
			setLastAction(
				`Reset · ${r.reset.cancelledJobs} cancelled · ${r.reset.clearedItemStatuses} statuses cleared`,
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (e) {
			setLastAction(
				`Reset error: ${e instanceof Error ? e.message : String(e)}`,
			);
		} finally {
			setIsRunning(false);
		}
	}, [invalidateWorkflowQueries, isRunning, refreshState]);

	const handleMatchOnlyReset = useCallback(async () => {
		if (isRunning) return;
		setIsRunning(true);
		setLastAction("Resetting match snapshot…");
		try {
			const r = await resetMatchSnapshotReplay();
			setLastAction(
				`Match reset · ${r.reset.cancelledJobs} cancelled · ${r.reset.clearedMatchSnapshots} snapshots cleared`,
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (e) {
			setLastAction(
				`Reset error: ${e instanceof Error ? e.message : String(e)}`,
			);
		} finally {
			setIsRunning(false);
		}
	}, [invalidateWorkflowQueries, isRunning, refreshState]);

	// ---- Onboarding step handler ----
	const handleOnboardingNav = useCallback(
		async (target: OnboardingStep | "prev" | "next") => {
			if (isRunning) return;
			setIsRunning(true);

			const cached = queryClient.getQueryData<OnboardingAuthPayload>(
				ONBOARDING_SESSION_QUERY_KEY,
			);
			const currentStep: OnboardingStep =
				cached?.session.status === "complete"
					? "complete"
					: (cached?.session.status ?? "welcome");
			const currentIdx = ONBOARDING_STEPS.indexOf(currentStep);

			let nextStep: OnboardingStep;
			if (target === "prev") {
				if (currentIdx <= 0) {
					setLastAction(`Already at first step (${currentStep})`);
					setIsRunning(false);
					return;
				}
				nextStep = ONBOARDING_STEPS[currentIdx - 1]!;
			} else if (target === "next") {
				if (currentIdx >= ONBOARDING_STEPS.length - 1) {
					setLastAction(`Already at last step (${currentStep})`);
					setIsRunning(false);
					return;
				}
				nextStep = ONBOARDING_STEPS[currentIdx + 1]!;
			} else {
				nextStep = target;
			}

			try {
				setLastAction(`Setting step → ${nextStep}…`);
				await saveOnboardingStep({ data: { step: nextStep } });

				// Fetch the authoritative session so the resolver can make routing
				// decisions against it — jumping into a walkthrough step without a
				// demo song trips the dev invariant loudly, which is what we want.
				const nextSession = await queryClient.fetchQuery({
					queryKey: ONBOARDING_SESSION_QUERY_KEY,
					queryFn: () => getOnboardingSession(),
				});

				const resolved = resolveSession(nextSession.session);
				if (resolved.allowedPath === "/onboarding") {
					await router.navigate({
						to: "/onboarding",
						search: { step: nextStep },
					});
				} else {
					await router.navigate({ to: resolved.allowedPath });
				}

				setLastAction(`${currentStep} → ${nextStep}`);
			} catch (e) {
				setLastAction(
					`Step error: ${e instanceof Error ? e.message : String(e)}`,
				);
			} finally {
				setIsRunning(false);
			}
		},
		[queryClient, router, isRunning],
	);

	// ---- Onboarding current step (reactive subscription) ----
	// Subscribes to the same cache entry populated by `/_authenticated`'s
	// `beforeLoad` — so the step label/highlight re-renders when a
	// navigation or handler refetches the session.
	const { data: liveOnboarding } = useQuery<OnboardingAuthPayload>({
		queryKey: ONBOARDING_SESSION_QUERY_KEY,
		queryFn: () => getOnboardingSession(),
	});
	const currentOnboardingStep: OnboardingStep =
		liveOnboarding?.session.status === "complete"
			? "complete"
			: (liveOnboarding?.session.status ?? "welcome");

	// ---- Progress hooks ----
	const enrichProgress = useLibraryProcessingJobProgress(
		wfState?.enrichment.activeJobId,
		settingsParams.polling.jobProgressPollMs,
	);
	const matchProgress = useLibraryProcessingJobProgress(
		wfState?.matchSnapshotRefresh.activeJobId,
		settingsParams.polling.jobProgressPollMs,
	);

	return (
		<PaneRoot>
			<PanelChildren
				activeTab={activeTab}
				isRunning={isRunning}
				lastAction={lastAction}
				wfState={wfState}
				enrichProgress={enrichProgress}
				matchProgress={matchProgress}
				onStep={handleStep}
				onRunUntilIdle={handleRunUntilIdle}
				currentOnboardingStep={currentOnboardingStep}
				onboardingSliderIndex={onboardingParams.stepIndex}
			/>
		</PaneRoot>
	);
}

// ---------------------------------------------------------------------------
// Children rendered inside the panel via React portal
// ---------------------------------------------------------------------------

const S = {
	root: {
		fontSize: 11,
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		color: "#d4d4d8",
		lineHeight: 1.45,
		display: "grid",
		gap: 8,
	} satisfies CSSProperties,
	actionBar: {
		display: "flex",
		gap: 6,
	} satisfies CSSProperties,
	actionBtn: {
		flex: 1,
		padding: "7px 0",
		fontSize: 11,
		fontWeight: 600,
		fontFamily: "inherit",
		color: "#d4d4d4",
		background: "#1a1a1a",
		border: "1px solid #2a2a2a",
		borderRadius: 6,
		cursor: "pointer",
	} satisfies CSSProperties,
	actionBtnActive: {
		color: "#fde68a",
		borderColor: "#fde68a40",
	} satisfies CSSProperties,
	label: { color: "#737373", fontSize: 10 } satisfies CSSProperties,
	meta: { color: "#a3a3a3" } satisfies CSSProperties,
	card: {
		padding: 8,
		background: "#111111",
		borderRadius: 8,
		display: "grid",
		gap: 6,
	} satisfies CSSProperties,
	row: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
	} satisfies CSSProperties,
	lastAction: {
		padding: "5px 7px",
		background: "#141414",
		borderRadius: 6,
		wordBreak: "break-word" as const,
		color: "#a3a3a3",
	} satisfies CSSProperties,
};

function PanelChildren({
	activeTab,
	isRunning,
	lastAction,
	wfState,
	enrichProgress,
	matchProgress,
	onStep,
	onRunUntilIdle,
	currentOnboardingStep,
	onboardingSliderIndex,
}: {
	activeTab: string | null;
	isRunning: boolean;
	lastAction: string;
	wfState: GuidedWorkflowState | null;
	enrichProgress: LibraryProcessingJobProgress | null;
	matchProgress: LibraryProcessingJobProgress | null;
	onStep: () => void;
	onRunUntilIdle: () => void;
	currentOnboardingStep: OnboardingStep;
	onboardingSliderIndex: number;
}) {
	const currentIdx = ONBOARDING_STEPS.indexOf(currentOnboardingStep);

	return (
		<div style={S.root}>
			{/* Action bar — only on Enrichment/Matching tabs */}
			{(activeTab === "Enrichment" || activeTab === "Matching") && (
				<div style={S.actionBar}>
					<button
						type="button"
						style={{ ...S.actionBtn, ...(isRunning ? S.actionBtnActive : {}) }}
						onClick={onStep}
						disabled={isRunning}
					>
						Step Next
					</button>
					<button
						type="button"
						style={{ ...S.actionBtn, ...(isRunning ? S.actionBtnActive : {}) }}
						onClick={onRunUntilIdle}
						disabled={isRunning}
					>
						Run All
					</button>
				</div>
			)}

			{/* Tab-specific live state */}
			{activeTab === "Enrichment" && (
				<JobCard
					title="Enrichment"
					jobId={wfState?.enrichment.activeJobId ?? null}
					progress={enrichProgress}
					stageOrder={ENRICHMENT_STAGE_NAMES}
					extra={
						enrichProgress?.type === "enrichment"
							? `batch ${enrichProgress.progress.batchSequence + 1} · ${enrichProgress.progress.done}/${enrichProgress.progress.total} items`
							: null
					}
				/>
			)}

			{activeTab === "Matching" && (
				<JobCard
					title="Match Refresh"
					jobId={wfState?.matchSnapshotRefresh.activeJobId ?? null}
					progress={matchProgress}
					stageOrder={MATCH_REFRESH_STAGE_NAMES}
					extra={
						matchProgress?.type === "match_snapshot_refresh"
							? `${matchProgress.progress.playlistCount ?? 0} playlists · ${matchProgress.progress.candidateCount ?? 0} candidates · ${matchProgress.progress.matchedSongCount ?? 0} matched`
							: null
					}
				/>
			)}

			{/* Queue summary — on Enrichment and Matching tabs */}
			{(activeTab === "Enrichment" || activeTab === "Matching") &&
				wfState &&
				wfState.pendingJobs.length > 0 && (
					<div style={S.card}>
						<div style={{ ...S.row }}>
							<span style={{ color: "#fff", fontWeight: 700 }}>Queue</span>
							<Badge
								label={`${wfState.pendingJobs.length} jobs`}
								status="active"
							/>
						</div>
						{wfState.pendingJobs.slice(0, 4).map((job) => (
							<div key={job.id} style={{ ...S.meta }}>
								{job.type === "match_snapshot_refresh" ? "match" : "enrich"} ·{" "}
								{job.status} · {shortId(job.id)}
							</div>
						))}
					</div>
				)}

			{/* Onboarding tab — step list */}
			{activeTab === "Onboarding" && (
				<div style={S.card}>
					<div style={S.row}>
						<span style={{ color: "#fff", fontWeight: 700 }}>Steps</span>
						<Badge
							label={`${currentIdx + 1}/${ONBOARDING_STEPS.length}`}
							status={
								currentOnboardingStep === "complete" ? "completed" : "active"
							}
						/>
					</div>
					<div style={{ display: "grid", gap: 2 }}>
						{ONBOARDING_STEPS.map((step, i) => {
							const isCurrent = i === currentIdx;
							const isSliderTarget = i === onboardingSliderIndex;
							return (
								<div
									key={step}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										padding: "2px 4px",
										borderRadius: 4,
										background:
											isSliderTarget && !isCurrent
												? "rgba(255,255,255,0.04)"
												: "transparent",
									}}
								>
									<span
										style={{
											width: 14,
											textAlign: "right",
											color: "#525252",
											fontSize: 10,
										}}
									>
										{i}
									</span>
									<span
										style={{
											color: isCurrent
												? "#86efac"
												: isSliderTarget
													? "#fde68a"
													: "#737373",
											fontWeight: isCurrent ? 700 : 400,
										}}
									>
										{isCurrent ? "→ " : "  "}
										{step}
									</span>
								</div>
							);
						})}
					</div>
					<div style={{ ...S.label, marginTop: 2 }}>
						Slider target: {ONBOARDING_STEPS[onboardingSliderIndex]}
					</div>
				</div>
			)}

			{/* Last action */}
			{lastAction && <div style={S.lastAction}>{lastAction}</div>}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function JobCard({
	title,
	jobId,
	progress,
	stageOrder,
	extra,
}: {
	title: string;
	jobId: string | null;
	progress: LibraryProcessingJobProgress | null;
	stageOrder: readonly string[];
	extra: string | null;
}) {
	const isActive =
		progress !== null &&
		(progress.status === "running" || progress.status === "pending");

	return (
		<div style={S.card}>
			<div style={S.row}>
				<span style={{ color: "#fff", fontWeight: 700 }}>{title}</span>
				<Badge
					label={isActive ? progress.status : jobId ? "done" : "idle"}
					status={isActive ? "active" : "idle"}
				/>
			</div>

			{progress ? (
				<>
					{/* Progress bar */}
					<div
						style={{
							height: 5,
							background: "#1e1e1e",
							borderRadius: 999,
							overflow: "hidden",
						}}
					>
						<div
							style={{
								width: `${progress.progress.total === 0 ? 0 : (progress.progress.done / progress.progress.total) * 100}%`,
								height: "100%",
								background:
									progress.status === "failed" ? "#fca5a5" : "#86efac",
								transition: "width 0.3s",
							}}
						/>
					</div>

					{/* Extra summary */}
					{extra && <div style={S.meta}>{extra}</div>}

					{/* Stage chips */}
					<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
						{stageOrder.map((stage) => {
							const sp = (
								progress.progress.stages as Record<
									string,
									{ status: StageStatus } | undefined
								>
							)[stage];
							const status = sp?.status ?? "pending";
							const current = progress.progress.currentStage === stage;
							return (
								<span
									key={stage}
									style={{
										padding: "2px 6px",
										borderRadius: 999,
										fontSize: 10,
										border: `1px solid ${current ? statusColor(status) : "#2a2a2a"}`,
										color: current ? "#fff" : statusColor(status),
										background: current
											? "rgba(255,255,255,0.06)"
											: "transparent",
									}}
								>
									{formatStage(stage)}
								</span>
							);
						})}
					</div>

					{/* Job ID */}
					<div style={S.label}>job {shortId(jobId)}</div>
				</>
			) : (
				<div style={S.meta}>{jobId ? "Job completed." : "No active job."}</div>
			)}
		</div>
	);
}

function Badge({
	label,
	status,
}: {
	label: string;
	status: StageStatus | "idle" | "active";
}) {
	return (
		<span
			style={{
				padding: "2px 6px",
				borderRadius: 999,
				fontSize: 10,
				fontWeight: 700,
				textTransform: "uppercase",
				color: statusColor(status),
				border: `1px solid ${statusColor(status)}`,
			}}
		>
			{label}
		</span>
	);
}
