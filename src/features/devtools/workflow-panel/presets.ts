import type {
	WorkflowDevClientSettings,
	WorkflowDevServerSettings,
} from "@/lib/workflows/library-processing/devtools/settings";

export interface WorkflowPreset {
	id: string;
	name: string;
	client: WorkflowDevClientSettings;
	server: WorkflowDevServerSettings;
}

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
	{
		id: "fast",
		name: "Fast",
		client: { activeJobsPollMs: 1_000, jobProgressPollMs: 500 },
		server: {
			enrichmentStageDelayMs: 0,
			refreshStageDelayMs: 0,
			preSettlementDelayMs: 0,
			runUntilIdleMaxJobs: 30,
		},
	},
	{
		id: "watchable",
		name: "Watchable",
		client: { activeJobsPollMs: 1_500, jobProgressPollMs: 800 },
		server: {
			enrichmentStageDelayMs: 600,
			refreshStageDelayMs: 600,
			preSettlementDelayMs: 400,
			runUntilIdleMaxJobs: 20,
		},
	},
	{
		id: "slow-motion",
		name: "Slow Motion",
		client: { activeJobsPollMs: 1_000, jobProgressPollMs: 500 },
		server: {
			enrichmentStageDelayMs: 2_000,
			refreshStageDelayMs: 2_000,
			preSettlementDelayMs: 1_000,
			runUntilIdleMaxJobs: 10,
		},
	},
];
