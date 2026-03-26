import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import { getActiveJob, type JobProgress } from "@/lib/data/jobs";

export interface ActiveJobInfo {
	id: string;
	status: "pending" | "running";
	progress: { done: number; total: number; succeeded: number; failed: number };
}

export interface ActiveJobs {
	enrichment: ActiveJobInfo | null;
	targetPlaylistMatchRefresh: ActiveJobInfo | null;
}

export const getActiveJobs = createServerFn({ method: "GET" }).handler(
	async (): Promise<ActiveJobs> => {
		const { session } = await requireAuthSession();

		const [enrichmentResult, refreshResult] = await Promise.all([
			getActiveJob(session.accountId, "enrichment"),
			getActiveJob(session.accountId, "target_playlist_match_refresh"),
		]);

		const toInfo = (result: typeof enrichmentResult): ActiveJobInfo | null => {
			if (Result.isError(result) || !result.value) return null;
			const job = result.value;
			const progress = (job.progress ?? {}) as JobProgress;
			return {
				id: job.id,
				status: job.status as "pending" | "running",
				progress: {
					done: progress.done ?? 0,
					total: progress.total ?? 0,
					succeeded: progress.succeeded ?? 0,
					failed: progress.failed ?? 0,
				},
			};
		};

		return {
			enrichment: toInfo(enrichmentResult),
			targetPlaylistMatchRefresh: toInfo(refreshResult),
		};
	},
);
