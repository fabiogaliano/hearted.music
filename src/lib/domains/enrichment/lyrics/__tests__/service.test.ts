import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "@/lib/data/database.types";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	getSongLyricsDocument,
	LYRICS_SCHEMA_VERSION,
	type LyricsDocument,
	type SongLyrics,
	upsertSongLyrics,
} from "../queries";
import { LyricsService } from "../service";
import { formatLyricsCompact } from "../utils/lyrics-formatter";
import type { TransformedLyricsBySection } from "../utils/lyrics-transformer";

vi.mock("../queries", () => ({
	getSongLyricsDocument: vi.fn(),
	upsertSongLyrics: vi.fn(),
	LYRICS_SCHEMA_VERSION: 1,
}));

const sampleSections: TransformedLyricsBySection[] = [
	{
		type: "Verse 1",
		lines: [
			{
				id: 1,
				text: "Line one",
				annotations: [
					{
						text: "Verified meaning",
						verified: true,
						votes_total: 12,
					},
				],
			},
			{ id: 2, text: "Line two" },
		],
	},
];

function makeStoredDocument(): LyricsDocument {
	return {
		schemaVersion: LYRICS_SCHEMA_VERSION,
		source: "genius",
		sections: sampleSections,
	};
}

function makeStoredDocumentJson(): Json {
	return {
		schemaVersion: LYRICS_SCHEMA_VERSION,
		source: "genius",
		sections: sampleSections.map((section) => ({
			type: section.type,
			lines: section.lines.map((line) => ({
				id: line.id,
				text: line.text,
				range: line.range
					? {
							start: line.range.start,
							end: line.range.end,
						}
					: undefined,
				annotations: line.annotations?.map((annotation) => ({
					text: annotation.text,
					verified: annotation.verified,
					votes_total: annotation.votes_total,
					pinnedRole: annotation.pinnedRole,
				})),
			})),
		})),
	} satisfies Json;
}

function makeSongLyricsRow(): SongLyrics {
	const now = new Date().toISOString();
	return {
		id: "row-1",
		song_id: "song-1",
		source: "genius",
		document: makeStoredDocumentJson(),
		content_hash: "ly_v1_hash",
		has_annotations: true,
		schema_version: LYRICS_SCHEMA_VERSION,
		created_at: now,
		updated_at: now,
	};
}

describe("LyricsService.fetchAndStoreLyrics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns cached lyrics without refetching", async () => {
		vi.mocked(getSongLyricsDocument).mockResolvedValueOnce(
			Result.ok(makeStoredDocument()),
		);
		const service = new LyricsService({ accessToken: "token" });
		const getLyricsSpy = vi.spyOn(service, "getLyrics");

		const result = await service.fetchAndStoreLyrics(
			"song-1",
			"Artist",
			"Title",
		);

		expect(Result.isOk(result)).toBe(true);
		expect(result).toEqual(Result.ok(formatLyricsCompact(sampleSections)));
		expect(getLyricsSpy).not.toHaveBeenCalled();
		expect(upsertSongLyrics).not.toHaveBeenCalled();
	});

	it("fetches and persists lyrics on cache miss", async () => {
		vi.mocked(getSongLyricsDocument).mockResolvedValueOnce(Result.ok(null));
		vi.mocked(upsertSongLyrics).mockResolvedValueOnce(
			Result.ok(makeSongLyricsRow()),
		);
		const service = new LyricsService({ accessToken: "token" });
		const getLyricsSpy = vi
			.spyOn(service, "getLyrics")
			.mockResolvedValueOnce(Result.ok(sampleSections));

		const result = await service.fetchAndStoreLyrics(
			"song-1",
			"Artist",
			"Title",
		);

		expect(Result.isOk(result)).toBe(true);
		expect(result).toEqual(Result.ok(formatLyricsCompact(sampleSections)));
		expect(getLyricsSpy).toHaveBeenCalledWith("Artist", "Title");
		expect(upsertSongLyrics).toHaveBeenCalledWith("song-1", sampleSections);
	});

	it("falls back to Genius when cache lookup fails", async () => {
		vi.mocked(getSongLyricsDocument).mockResolvedValueOnce(
			Result.err(
				new DatabaseError({
					code: "db_down",
					message: "cache unavailable",
				}),
			),
		);
		vi.mocked(upsertSongLyrics).mockResolvedValueOnce(
			Result.ok(makeSongLyricsRow()),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const service = new LyricsService({ accessToken: "token" });
		const getLyricsSpy = vi
			.spyOn(service, "getLyrics")
			.mockResolvedValueOnce(Result.ok(sampleSections));

		const result = await service.fetchAndStoreLyrics(
			"song-1",
			"Artist",
			"Title",
		);

		expect(Result.isOk(result)).toBe(true);
		expect(result).toEqual(Result.ok(formatLyricsCompact(sampleSections)));
		expect(getLyricsSpy).toHaveBeenCalledWith("Artist", "Title");
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
