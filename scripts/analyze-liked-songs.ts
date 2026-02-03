/**
 * Script to analyze recent liked songs using LLM.
 * Usage: bun run scripts/analyze-liked-songs.ts [username] [limit] [--dry-run]
 */

import { Result } from "better-result";
import * as likedSongData from "@/lib/data/liked-song";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { LlmService } from "@/lib/ml/llm/service";
import { SongAnalysisService } from "@/lib/capabilities/analysis/song-analysis";
import { LyricsService } from "@/lib/capabilities/lyrics/service";
import * as audioFeatureData from "@/lib/data/song-audio-feature";

const username = process.argv[2] || "kapran0s";
const limit = parseInt(process.argv[3] || "5", 10);
const dryRun = process.argv.includes("--dry-run");

async function main() {
	// Check env vars upfront
	const geminiKey = process.env.GEMINI_API_KEY;
	const geniusToken = process.env.GENIUS_CLIENT_TOKEN;

	if (!dryRun) {
		if (!geminiKey) {
			console.error("❌ Missing GEMINI_API_KEY");
			process.exit(1);
		}
		if (!geniusToken) {
			console.error("❌ Missing GENIUS_CLIENT_TOKEN");
			process.exit(1);
		}
		console.log(`✓ GEMINI_API_KEY: ${geminiKey.substring(0, 8)}...`);
		console.log(`✓ GENIUS_CLIENT_TOKEN: ${geniusToken.substring(0, 8)}...\n`);
	}

	console.log(`🎵 Analyzing liked songs for ${username}...\n`);

	const supabase = createAdminSupabaseClient();

	// Get account
	const { data: accounts } = await supabase
		.from("account")
		.select("id, display_name, spotify_id")
		.or(`display_name.eq.${username},spotify_id.eq.${username}`)
		.limit(1);

	if (!accounts || accounts.length === 0) {
		console.error(`❌ User not found: ${username}`);
		process.exit(1);
	}

	const account = accounts[0];
	console.log(`✓ Found account: ${account.display_name || account.spotify_id}`);

	// Get recent liked songs
	const likedResult = await likedSongData.getPageWithDetails(account.id, {
		limit,
		filter: "all",
	});

	if (Result.isError(likedResult)) {
		console.error(`❌ Error fetching liked songs:`, likedResult.error);
		process.exit(1);
	}

	const { items } = likedResult.value;
	const toAnalyze = items.filter((s) => !s.analysis_id);

	console.log(`✓ Found ${items.length} songs, ${toAnalyze.length} need analysis\n`);

	if (toAnalyze.length === 0) {
		console.log("Nothing to analyze!");
		process.exit(0);
	}

	// Show songs
	for (const song of toAnalyze) {
		console.log(`  • ${song.song_artists.join(", ")} - ${song.song_name}`);
	}

	if (dryRun) {
		console.log("\n[DRY RUN - no analysis performed]");
		process.exit(0);
	}

	// Initialize services directly (no pipeline/SSE/jobs)
	console.log("\n⏳ Starting analysis...\n");

	const llm = new LlmService({ provider: "google", apiKey: geminiKey! });
	const analysisService = new SongAnalysisService(llm);
	const lyricsService = new LyricsService({ accessToken: geniusToken! });

	let succeeded = 0;
	let failed = 0;

	for (const song of toAnalyze) {
		const artist = song.song_artists.join(", ");
		const title = song.song_name;
		process.stdout.write(`📝 ${artist} - ${title}... `);

		// 1. Fetch lyrics from Genius
		const lyricsResult = await lyricsService.getLyricsText(artist, title);
		if (Result.isError(lyricsResult)) {
			const err = lyricsResult.error as Error;
			console.log(`❌ Genius: ${err.message}`);
			failed++;
			continue;
		}

		const lyrics = lyricsResult.value;
		if (!lyrics) {
			console.log(`❌ No lyrics found`);
			failed++;
			continue;
		}
		process.stdout.write(`lyrics ✓ `);

		// 2. Get audio features (optional)
		const audioResult = await audioFeatureData.get(song.song_id);
		const audioFeatures = Result.isOk(audioResult) ? audioResult.value : null;

		// 3. Analyze with LLM
		process.stdout.write(`analyzing... `);
		const analysisResult = await analysisService.analyzeSong({
			songId: song.song_id,
			artist,
			title,
			lyrics,
			audioFeatures,
		});

		if (Result.isError(analysisResult)) {
			console.log(`❌ LLM error: ${analysisResult.error.message}`);
			failed++;
			continue;
		}

		const tokens = analysisResult.value.tokensUsed || "?";
		console.log(`✓ (${tokens} tokens)`);
		succeeded++;
	}

	console.log(`\n✅ Done: ${succeeded} analyzed, ${failed} failed`);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
