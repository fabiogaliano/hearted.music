import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	type ActiveJobs,
	buildActiveJobsSnapshot,
} from "@/lib/workflows/library-processing/active-jobs";

// buildActiveJobsSnapshot is referenced only inside the handler, so the
// server-fn compiler strips it (and its DB imports) from the client bundle.
export const getActiveJobs = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<ActiveJobs> => {
		const { session } = context;
		return buildActiveJobsSnapshot(session.accountId);
	});
