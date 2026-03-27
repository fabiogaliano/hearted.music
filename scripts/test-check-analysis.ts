/**
 * Disposable: check if song_analysis rows exist for batch songs.
 * Usage: bun scripts/test-check-analysis.ts
 */

import { createAdminSupabaseClient } from "@/lib/data/client";

const supabase = createAdminSupabaseClient();

const { data: account } = await supabase.from("account").select("id").limit(1).single();
if (!account) { console.error("No account"); process.exit(1); }
console.log(`Account: ${account.id}`);

const { data: likedSongs } = await supabase
	.from("liked_song")
	.select("song_id")
	.eq("account_id", account.id)
	.is("unliked_at", null)
	.order("liked_at", { ascending: false })
	.limit(5);

const songIds = likedSongs?.map(ls => ls.song_id) ?? [];
console.log(`Batch song IDs: ${songIds.join(", ")}`);

const { data: analyses, error } = await supabase
	.from("song_analysis")
	.select("song_id, created_at, model")
	.in("song_id", songIds);

console.log(`\nAnalysis rows found: ${analyses?.length ?? 0}`);
if (error) console.error("Query error:", error);

for (const a of analyses ?? []) {
	console.log(`  ${a.song_id} — model: ${a.model}, created: ${a.created_at}`);
}

const missing = songIds.filter(id => !analyses?.some(a => a.song_id === id));
if (missing.length > 0) {
	console.log(`\nMissing analysis for: ${missing.join(", ")}`);
}
