import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { guardRowCap } from "@/lib/data/row-cap-guard";
import { POSTGREST_MAX_ROWS } from "@/lib/shared/utils/result-wrappers/supabase";

const captureServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError,
}));

describe("guardRowCap", () => {
	it("regression: a failed capped read still reaches Sentry (callers that fall back on a failed read hid it, leaving only a log line)", async () => {
		const guarded = guardRowCap(
			vi.fn(
				async () =>
					new Response("[]", {
						status: 200,
						headers: { "Content-Range": "0-999/*" },
					}),
			),
		);

		const response = await guarded(
			"http://127.0.0.1:54321/rest/v1/playlist_song?select=song_id",
		);

		expect(response.status).toBe(500);
		expect(captureServerError).toHaveBeenCalledOnce();
	});

	it("pages at the max_rows set in supabase/config.toml", () => {
		const config = readFileSync(
			join(process.cwd(), "supabase/config.toml"),
			"utf8",
		);

		expect(config.match(/^max_rows\s*=\s*(\d+)/m)?.[1]).toBe(
			String(POSTGREST_MAX_ROWS),
		);
	});
});
