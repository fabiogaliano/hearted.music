import { createAdminSupabaseClient } from "@/lib/data/client";
import { log } from "./logger";

const KEEP_ALIVE_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000; // 4 days

export function startKeepAlive(): { stop: () => void } {
	async function ping() {
		const supabase = createAdminSupabaseClient();
		const { error } = await supabase
			.from("account")
			.select("id")
			.limit(1)
			.single();

		if (error && error.code !== "PGRST116") {
			log.warn("keep-alive-failed", { error: error.message });
		} else {
			log.info("keep-alive-ok");
		}
	}

	ping();

	const interval = setInterval(ping, KEEP_ALIVE_INTERVAL_MS);
	return { stop: () => clearInterval(interval) };
}
