import { useQueryClient } from "@tanstack/react-query";
import { DialStore, useDialKit } from "dialkit";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
	DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS,
	DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS,
	type WorkflowDevClientSettings,
	type WorkflowDevServerSettings,
} from "@/lib/workflows/library-processing/devtools/settings";

const DIAL_PANEL_NAME = "Library Processing";

function formatProgressSummary(
	progress: LibraryProcessingJobProgress | null,
): string {
	if (!progress) {
		return "idle";
	}

	if (progress.type === "enrichment") {
		const stage = progress.progress.currentStage ?? "queued";
		return `${stage} · batch ${progress.progress.batchSequence + 1} · ${progress.progress.done}/${progress.progress.total}`;
	}

	const stage = progress.progress.currentStage ?? "queued";
	const playlistCount = progress.progress.playlistCount ?? 0;
	const candidateCount = progress.progress.candidateCount ?? 0;
	const matchedSongCount = progress.progress.matchedSongCount ?? 0;
	return `${stage} · playlists ${playlistCount} · candidates ${candidateCount} · matched ${matchedSongCount}`;
}

function formatPendingJob(
	job: GuidedWorkflowState["pendingJobs"][number],
): string {
	if (job.progress.type === "enrichment") {
		const stage = job.progress.progress.currentStage ?? "queued";
		return `${job.type} · ${job.status} · ${stage}`;
	}

	if (job.progress.type === "match_snapshot_refresh") {
		const stage = job.progress.progress.currentStage ?? "queued";
		return `${job.type} · ${job.status} · ${stage}`;
	}

	return `${job.type} · ${job.status}`;
}

function getDialPanelId(): string | null {
	const panel = DialStore.getPanels().find(
		(item) => item.name === DIAL_PANEL_NAME,
	);
	return panel?.id ?? null;
}

function updateDialValue(path: string, value: number): void {
	const panelId = getDialPanelId();
	if (!panelId) {
		return;
	}

	DialStore.updateValue(panelId, path, value);
}

function applyPreset(
	presetId: string,
	updateClient: (partial: Partial<WorkflowDevClientSettings>) => void,
	updateServer: (partial: Partial<WorkflowDevServerSettings>) => void,
	setLastAction: (message: string) => void,
): void {
	const preset = WORKFLOW_PRESETS.find((item) => item.id === presetId);
	if (!preset) {
		return;
	}

	updateDialValue("polling.activeJobsPollMs", preset.client.activeJobsPollMs);
	updateDialValue("polling.jobProgressPollMs", preset.client.jobProgressPollMs);
	updateDialValue(
		"delays.enrichmentStageDelayMs",
		preset.server.enrichmentStageDelayMs,
	);
	updateDialValue(
		"delays.refreshStageDelayMs",
		preset.server.refreshStageDelayMs,
	);
	updateDialValue(
		"delays.preSettlementDelayMs",
		preset.server.preSettlementDelayMs,
	);
	updateDialValue(
		"limits.runUntilIdleMaxJobs",
		preset.server.runUntilIdleMaxJobs,
	);

	updateClient(preset.client);
	updateServer(preset.server);
	setLastAction(`Loaded ${preset.name.toLowerCase()} preset`);
}

export function DevWorkflowPanel() {
	const queryClient = useQueryClient();
	const { client, server, updateClient, updateServer, resetAll } =
		useWorkflowDevSettings();
	const [state, setState] = useState<GuidedWorkflowState | null>(null);
	const [lastAction, setLastAction] = useState("");
	const [isRunning, setIsRunning] = useState(false);

	const params = useDialKit(
		DIAL_PANEL_NAME,
		{
			polling: {
				activeJobsPollMs: [client.activeJobsPollMs, 500, 15_000, 500],
				jobProgressPollMs: [client.jobProgressPollMs, 500, 10_000, 500],
				_collapsed: true,
			},
			delays: {
				enrichmentStageDelayMs: [server.enrichmentStageDelayMs, 0, 5_000, 100],
				refreshStageDelayMs: [server.refreshStageDelayMs, 0, 5_000, 100],
				preSettlementDelayMs: [server.preSettlementDelayMs, 0, 3_000, 100],
				_collapsed: true,
			},
			limits: {
				runUntilIdleMaxJobs: [server.runUntilIdleMaxJobs, 1, 50, 1],
				_collapsed: true,
			},
			presets: {
				fast: { type: "action", label: "Fast" },
				watchable: { type: "action", label: "Watchable" },
				slowMotion: { type: "action", label: "Slow Motion" },
				resetTuning: { type: "action", label: "Reset Tuning" },
				_collapsed: true,
			},
			stepNext: { type: "action", label: "Step Next" },
			runUntilIdle: { type: "action", label: "Run Until Idle" },
			refreshState: { type: "action", label: "Refresh State" },
			warmReplayReset: { type: "action", label: "Warm Replay Reset" },
			matchOnlyReset: { type: "action", label: "Match-Only Reset" },
		},
		{
			onAction: (action) => {
				switch (action) {
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
					case "presets.resetTuning":
						updateDialValue(
							"polling.activeJobsPollMs",
							DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS.activeJobsPollMs,
						);
						updateDialValue(
							"polling.jobProgressPollMs",
							DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS.jobProgressPollMs,
						);
						updateDialValue(
							"delays.enrichmentStageDelayMs",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.enrichmentStageDelayMs,
						);
						updateDialValue(
							"delays.refreshStageDelayMs",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.refreshStageDelayMs,
						);
						updateDialValue(
							"delays.preSettlementDelayMs",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.preSettlementDelayMs,
						);
						updateDialValue(
							"limits.runUntilIdleMaxJobs",
							DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS.runUntilIdleMaxJobs,
						);
						resetAll();
						setLastAction("Reset guided workflow tuning to defaults");
						break;
					case "stepNext":
						void handleStep();
						break;
					case "runUntilIdle":
						void handleRunUntilIdle();
						break;
					case "refreshState":
						void refreshState(true);
						break;
					case "warmReplayReset":
						void handleWarmReplayReset();
						break;
					case "matchOnlyReset":
						void handleMatchOnlyReset();
						break;
				}
			},
		},
	);

	useEffect(() => {
		updateClient({
			activeJobsPollMs: params.polling.activeJobsPollMs,
			jobProgressPollMs: params.polling.jobProgressPollMs,
		});
	}, [
		params.polling.activeJobsPollMs,
		params.polling.jobProgressPollMs,
		updateClient,
	]);

	useEffect(() => {
		updateServer({
			enrichmentStageDelayMs: params.delays.enrichmentStageDelayMs,
			refreshStageDelayMs: params.delays.refreshStageDelayMs,
			preSettlementDelayMs: params.delays.preSettlementDelayMs,
			runUntilIdleMaxJobs: params.limits.runUntilIdleMaxJobs,
		});
	}, [
		params.delays.enrichmentStageDelayMs,
		params.delays.preSettlementDelayMs,
		params.delays.refreshStageDelayMs,
		params.limits.runUntilIdleMaxJobs,
		updateServer,
	]);

	const invalidateWorkflowQueries = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["active-jobs"] });
		queryClient.invalidateQueries({ queryKey: ["dashboard"] });
		queryClient.invalidateQueries({ queryKey: ["matching"] });
		queryClient.invalidateQueries({ queryKey: ["liked-songs"] });
		queryClient.invalidateQueries({ queryKey: ["playlists"] });
	}, [queryClient]);

	const refreshState = useCallback(async (showMessage: boolean) => {
		try {
			const nextState = await getGuidedWorkflowState();
			setState(nextState);
			if (showMessage) {
				setLastAction("Refreshed guided workflow state");
			}
		} catch (error) {
			setLastAction(
				`Refresh error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}, []);

	useEffect(() => {
		void refreshState(false);
	}, [refreshState]);

	const currentServerSettings = useMemo(
		() => ({
			enrichmentStageDelayMs: params.delays.enrichmentStageDelayMs,
			refreshStageDelayMs: params.delays.refreshStageDelayMs,
			preSettlementDelayMs: params.delays.preSettlementDelayMs,
			runUntilIdleMaxJobs: params.limits.runUntilIdleMaxJobs,
		}),
		[
			params.delays.enrichmentStageDelayMs,
			params.delays.preSettlementDelayMs,
			params.delays.refreshStageDelayMs,
			params.limits.runUntilIdleMaxJobs,
		],
	);

	const handleStep = useCallback(async () => {
		if (isRunning) {
			return;
		}

		setIsRunning(true);
		try {
			const result: StepResult = await stepLibraryProcessing({
				data: { settings: currentServerSettings },
			});
			setLastAction(
				result.stepped
					? `Stepped ${result.jobType} → ${result.outcome?.status ?? "unknown"}`
					: "No pending guided jobs for this account",
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (error) {
			setLastAction(
				`Step error: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setIsRunning(false);
		}
	}, [
		currentServerSettings,
		invalidateWorkflowQueries,
		isRunning,
		refreshState,
	]);

	const handleRunUntilIdle = useCallback(async () => {
		if (isRunning) {
			return;
		}

		setIsRunning(true);
		try {
			const result: RunUntilIdleResult = await runLibraryProcessingUntilIdle({
				data: { settings: currentServerSettings },
			});
			const completedCount = result.outcomes.filter(
				(outcome) => outcome.status === "completed",
			).length;
			const failedCount = result.outcomes.length - completedCount;
			setLastAction(
				`Ran ${result.jobsRun} jobs (${completedCount} completed, ${failedCount} failed) · ${result.stoppedReason}`,
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (error) {
			setLastAction(
				`Run error: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setIsRunning(false);
		}
	}, [
		currentServerSettings,
		invalidateWorkflowQueries,
		isRunning,
		refreshState,
	]);

	const handleWarmReplayReset = useCallback(async () => {
		if (isRunning) {
			return;
		}

		setIsRunning(true);
		try {
			const result = await resetLibraryProcessingWarmReplay();
			setLastAction(
				`Warm replay reset · ${result.reset.cancelledJobs} jobs cancelled · ${result.reset.clearedItemStatuses} statuses cleared · match refresh requested: ${result.reseed.matchRefreshRequested ? "yes" : "no"}`,
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (error) {
			setLastAction(
				`Warm replay reset error: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setIsRunning(false);
		}
	}, [invalidateWorkflowQueries, isRunning, refreshState]);

	const handleMatchOnlyReset = useCallback(async () => {
		if (isRunning) {
			return;
		}

		setIsRunning(true);
		try {
			const result = await resetMatchSnapshotReplay();
			setLastAction(
				`Match-only reset · ${result.reset.cancelledJobs} jobs cancelled · ${result.reset.clearedMatchContexts} match snapshots cleared`,
			);
			invalidateWorkflowQueries();
			await refreshState(false);
		} catch (error) {
			setLastAction(
				`Match-only reset error: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setIsRunning(false);
		}
	}, [invalidateWorkflowQueries, isRunning, refreshState]);

	const enrichmentProgress = useLibraryProcessingJobProgress(
		state?.enrichment.activeJobId,
	);
	const refreshProgress = useLibraryProcessingJobProgress(
		state?.matchSnapshotRefresh.activeJobId,
	);

	const pendingJobPreview = useMemo(
		() => state?.pendingJobs.slice(0, 4) ?? [],
		[state?.pendingJobs],
	);

	return (
		<div
			style={{
				position: "fixed",
				bottom: 12,
				left: 12,
				zIndex: 99_998,
				background: "rgba(0, 0, 0, 0.86)",
				color: "#d4d4d8",
				borderRadius: 10,
				padding: "10px 12px",
				fontSize: 11,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				maxWidth: 360,
				boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
				pointerEvents: "auto",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
					marginBottom: 6,
				}}
			>
				<div style={{ fontWeight: 700, color: "#fff" }}>Guided Workflow</div>
				<div style={{ color: isRunning ? "#fde68a" : "#86efac" }}>
					{isRunning ? "running" : "ready"}
				</div>
			</div>

			<div style={{ opacity: 0.7, lineHeight: 1.5, marginBottom: 8 }}>
				Use <code>bun run dev:guided</code> or <code>bun run dev:web</code>.
			</div>

			{state ? (
				<div style={{ display: "grid", gap: 6, lineHeight: 1.5 }}>
					<div>
						<div style={{ color: "#fff" }}>Enrichment</div>
						<div>{formatProgressSummary(enrichmentProgress)}</div>
					</div>
					<div>
						<div style={{ color: "#fff" }}>Match refresh</div>
						<div>{formatProgressSummary(refreshProgress)}</div>
					</div>
					<div>
						<div style={{ color: "#fff" }}>Queue</div>
						<div>
							{state.pendingJobs.length} pending/running job
							{state.pendingJobs.length === 1 ? "" : "s"}
						</div>
						{pendingJobPreview.length > 0 && (
							<div style={{ marginTop: 4, display: "grid", gap: 2 }}>
								{pendingJobPreview.map((job) => (
									<div key={job.id} style={{ opacity: 0.85 }}>
										• {formatPendingJob(job)}
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			) : (
				<div style={{ opacity: 0.6 }}>Loading guided workflow state…</div>
			)}

			{lastAction ? (
				<div
					style={{
						marginTop: 8,
						padding: "6px 8px",
						background: "rgba(255, 255, 255, 0.06)",
						borderRadius: 6,
						lineHeight: 1.45,
						wordBreak: "break-word",
					}}
				>
					{lastAction}
				</div>
			) : null}
		</div>
	);
}
