/**
 * Smoke test: Verify cache lookup correctly handles model_version changes
 *
 * Tests the fix for the critical bug where cache lookups ignored model_version,
 * causing either stale data or .single() failures when multiple versions existed.
 *
 * This test verifies:
 * 1. Embeddings can be inserted with different model_versions
 * 2. getSongEmbedding returns the LATEST embedding (by created_at)
 * 3. getSongEmbeddingsBatch correctly handles multiple versions per song
 * 4. No .single() errors occur when multiple versions exist
 */

import { Result } from "better-result";
import * as vectors from "@/lib/data/vectors";
import { createAdminSupabaseClient } from "@/lib/data/client";

const TEST_SONG_ID = "00000000-0000-0000-0000-000000000999";
const TEST_SONG_ID_2 = "00000000-0000-0000-0000-000000000998";
const TEST_MODEL = "test-model-e5-large";
const TEST_KIND = "full" as const;

async function setupTestSong(songId: string) {
	const supabase = createAdminSupabaseClient();

	// Check if song exists
	const { data: existing, error: queryError } = await supabase
		.from("song")
		.select("id")
		.eq("id", songId)
		.maybeSingle();

	if (queryError) {
		throw new Error(`Failed to query song: ${queryError.message}`);
	}

	if (!existing) {
		// Create test song
		const { error: insertError } = await supabase.from("song").insert({
			id: songId,
			spotify_id: `test-spotify-${songId}`,
			name: "Test Song",
			artists: ["Test Artist"],
			album_name: "Test Album",
		});

		if (insertError) {
			throw new Error(`Failed to create test song: ${insertError.message}`);
		}
		console.log(`  Created test song: ${songId}`);
	} else {
		console.log(`  Test song already exists: ${songId}`);
	}
}

async function cleanupEmbeddings() {
	const supabase = createAdminSupabaseClient();

	// Clean up embeddings only (keep songs for reuse)
	await supabase
		.from("song_embedding")
		.delete()
		.eq("song_id", TEST_SONG_ID)
		.eq("model", TEST_MODEL);

	await supabase
		.from("song_embedding")
		.delete()
		.eq("song_id", TEST_SONG_ID_2)
		.eq("model", TEST_MODEL);
}

async function cleanupAll() {
	const supabase = createAdminSupabaseClient();

	// Clean up embeddings
	await cleanupEmbeddings();

	// Clean up test songs
	await supabase.from("song").delete().eq("id", TEST_SONG_ID);
	await supabase.from("song").delete().eq("id", TEST_SONG_ID_2);

	console.log("✓ Cleaned up all test data");
}

async function insertEmbeddingWithVersion(
	modelVersion: string,
	contentHash: string,
	delayMs = 0,
) {
	// Add delay to ensure created_at ordering
	if (delayMs > 0) {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}

	const embedding = new Array(1024).fill(0).map((_, i) => i / 1024);
	const result = await vectors.upsertSongEmbedding({
		song_id: TEST_SONG_ID,
		kind: TEST_KIND,
		model: TEST_MODEL,
		model_version: modelVersion,
		dims: 1024,
		content_hash: contentHash,
		embedding: JSON.stringify(embedding),
	});

	if (Result.isError(result)) {
		throw new Error(`Failed to insert embedding: ${result.error}`);
	}

	return result.value;
}

async function testSingleVersionLookup() {
	console.log("\n=== Test 1: Single version lookup ===");

	// Insert v1
	await insertEmbeddingWithVersion("hash_v1", "content_hash_1");

	// Lookup should succeed
	const result = await vectors.getSongEmbedding(
		TEST_SONG_ID,
		TEST_MODEL,
		TEST_KIND,
	);

	if (Result.isError(result)) {
		throw new Error(`Lookup failed: ${result.error}`);
	}

	if (!result.value) {
		throw new Error("Expected embedding, got null");
	}

	if (result.value.model_version !== "hash_v1") {
		throw new Error(
			`Expected model_version 'hash_v1', got '${result.value.model_version}'`,
		);
	}

	console.log("✓ Single version lookup works");
}

async function testMultipleVersionsReturnsLatest() {
	console.log("\n=== Test 2: Multiple versions returns latest ===");

	// Insert v1
	const v1 = await insertEmbeddingWithVersion("hash_v1", "content_hash_1");
	console.log(`  Inserted v1 at ${v1.created_at}`);

	// Wait 100ms then insert v2
	const v2 = await insertEmbeddingWithVersion(
		"hash_v2",
		"content_hash_1",
		100,
	);
	console.log(`  Inserted v2 at ${v2.created_at}`);

	// Lookup should return v2 (latest)
	const result = await vectors.getSongEmbedding(
		TEST_SONG_ID,
		TEST_MODEL,
		TEST_KIND,
	);

	if (Result.isError(result)) {
		throw new Error(`Lookup failed: ${result.error}`);
	}

	if (!result.value) {
		throw new Error("Expected embedding, got null");
	}

	if (result.value.model_version !== "hash_v2") {
		throw new Error(
			`Expected latest model_version 'hash_v2', got '${result.value.model_version}'`,
		);
	}

	console.log("✓ Multiple versions correctly returns latest (v2)");
}

async function testBatchQueryWithMultipleVersions() {
	console.log("\n=== Test 3: Batch query with multiple versions ===");

	const song1Id = TEST_SONG_ID;
	const song2Id = TEST_SONG_ID_2;

	// Setup song2 (already done in main)

	// Insert v1 for both songs
	await vectors.upsertSongEmbedding({
		song_id: song1Id,
		kind: TEST_KIND,
		model: TEST_MODEL,
		model_version: "hash_v1",
		dims: 1024,
		content_hash: "hash1",
		embedding: JSON.stringify(new Array(1024).fill(1)),
	});

	await vectors.upsertSongEmbedding({
		song_id: song2Id,
		kind: TEST_KIND,
		model: TEST_MODEL,
		model_version: "hash_v1",
		dims: 1024,
		content_hash: "hash2",
		embedding: JSON.stringify(new Array(1024).fill(2)),
	});

	// Wait and insert v2 for both songs
	await new Promise((resolve) => setTimeout(resolve, 100));

	await vectors.upsertSongEmbedding({
		song_id: song1Id,
		kind: TEST_KIND,
		model: TEST_MODEL,
		model_version: "hash_v2",
		dims: 1024,
		content_hash: "hash1",
		embedding: JSON.stringify(new Array(1024).fill(1)),
	});

	await vectors.upsertSongEmbedding({
		song_id: song2Id,
		kind: TEST_KIND,
		model: TEST_MODEL,
		model_version: "hash_v2",
		dims: 1024,
		content_hash: "hash2",
		embedding: JSON.stringify(new Array(1024).fill(2)),
	});

	// Batch lookup should return v2 for both songs
	const result = await vectors.getSongEmbeddingsBatch(
		[song1Id, song2Id],
		TEST_MODEL,
		TEST_KIND,
	);

	if (Result.isError(result)) {
		throw new Error(`Batch lookup failed: ${result.error}`);
	}

	const embMap = result.value;

	if (embMap.size !== 2) {
		throw new Error(`Expected 2 embeddings, got ${embMap.size}`);
	}

	const emb1 = embMap.get(song1Id);
	const emb2 = embMap.get(song2Id);

	if (!emb1 || !emb2) {
		throw new Error("Missing embeddings in batch result");
	}

	if (emb1.model_version !== "hash_v2") {
		throw new Error(
			`Song1: Expected model_version 'hash_v2', got '${emb1.model_version}'`,
		);
	}

	if (emb2.model_version !== "hash_v2") {
		throw new Error(
			`Song2: Expected model_version 'hash_v2', got '${emb2.model_version}'`,
		);
	}

	console.log("✓ Batch query correctly returns latest versions for all songs");
}

async function testNoSingleErrorWithMultipleVersions() {
	console.log("\n=== Test 4: No .single() errors with multiple versions ===");

	// This test verifies that the old bug (calling .single() without ordering)
	// is fixed. The old code would throw when multiple versions existed.

	// Insert v1 and v2
	await insertEmbeddingWithVersion("hash_v1", "content_hash_1");
	await insertEmbeddingWithVersion("hash_v2", "content_hash_1", 100);

	// This should NOT throw
	try {
		const result = await vectors.getSongEmbedding(
			TEST_SONG_ID,
			TEST_MODEL,
			TEST_KIND,
		);

		if (Result.isError(result)) {
			throw new Error(`Unexpected error: ${result.error}`);
		}

		console.log("✓ No .single() error when multiple versions exist");
	} catch (error) {
		throw new Error(
			`FAILED: Got .single() error with multiple versions: ${error}`,
		);
	}
}

async function main() {
	console.log("🧪 Cache Lookup Model Version Fix - Smoke Test\n");

	try {
		// Setup: Clean everything and create test songs
		await cleanupAll();
		await setupTestSong(TEST_SONG_ID);
		await setupTestSong(TEST_SONG_ID_2);
		console.log("✓ Setup complete\n");

		// Run tests (clean embeddings between tests)
		await testSingleVersionLookup();
		await cleanupEmbeddings();

		await testMultipleVersionsReturnsLatest();
		await cleanupEmbeddings();

		await testBatchQueryWithMultipleVersions();
		await cleanupEmbeddings();

		await testNoSingleErrorWithMultipleVersions();

		// Final cleanup
		await cleanupAll();

		console.log("\n✅ All tests passed!");
		console.log("\nVerified:");
		console.log("  • Single version lookups work correctly");
		console.log("  • Multiple versions return the latest (by created_at)");
		console.log("  • Batch queries handle multiple versions per song");
		console.log("  • No .single() errors when multiple versions exist");
	} catch (error) {
		console.error("\n❌ Test failed:");
		console.error(error);
		await cleanupAll();
		process.exit(1);
	}
}

main();
