import { useQuery } from "@tanstack/react-query";
import {
	getLibraryProcessingJobProgress,
	type LibraryProcessingJobProgress,
} from "@/lib/server/jobs.functions";
import { readWorkflowDevSettings } from "@/lib/workflows/library-processing/devtools/settings";

const DEFAULT_POLL_MS = 3_000;

function resolveJobProgressPollMs(explicitPollMs: number | undefined): number {
	if (explicitPollMs !== undefined) {
		return explicitPollMs;
	}

	if (import.meta.env.DEV) {
		return readWorkflowDevSettings().client.jobProgressPollMs;
	}

	return DEFAULT_POLL_MS;
}

export function useLibraryProcessingJobProgress(
	jobId: string | null | undefined,
	pollMs?: number,
): LibraryProcessingJobProgress | null {
	const { data } = useQuery({
		queryKey: ["library-processing-progress", jobId],
		queryFn: () =>
			jobId ? getLibraryProcessingJobProgress({ data: { jobId } }) : null,
		enabled: !!jobId,
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (status === "completed" || status === "failed") {
				return false;
			}

			return resolveJobProgressPollMs(pollMs);
		},
	});

	return data ?? null;
}
