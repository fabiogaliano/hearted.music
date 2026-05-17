import type { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Job, JobType } from "@/lib/platform/jobs/repository";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMaybe } from "@/lib/shared/utils/result-wrappers/supabase";

const SYNC_JOB_TYPES: JobType[] = [
	"sync_liked_songs",
	"sync_playlists",
	"sync_playlist_tracks",
];

export function getLastCompletedSync(
	accountId: string,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.eq("status", "completed")
			.in("type", SYNC_JOB_TYPES)
			.order("completed_at", { ascending: false })
			.limit(1)
			.single(),
	);
}
