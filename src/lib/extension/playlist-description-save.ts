import type { SpotifyErrorCode } from "../../../shared/spotify-command-protocol";
import { acknowledgePlaylistUpdate } from "@/lib/server/playlists.functions";
import {
	outcomeFromAcknowledgedResult,
	outcomeFromCommandResponse,
} from "./spotify-action-outcome";
import { fetchPlaylistMetadata } from "./spotify-client";
import {
	type AcknowledgedResult,
	updatePlaylistAcknowledged,
} from "./playlist-write-acknowledgement";

type UpdatePlaylistResult = { revision: string };

type PlaylistMetadataSnapshot = {
	name: string;
	description: string | null;
	trackCount: number;
	imageUrl: string | null;
};

export type PreparedPlaylistDescriptionSave = {
	spotifyId: string;
	nextDescription: string;
	latestMetadata: PlaylistMetadataSnapshot;
};

export type PreparedPlaylistMetadataSyncResult =
	| { ok: true }
	| { ok: false; error: unknown };

export type PlaylistDescriptionSavePreparationResult =
	| {
			status: "ready";
			commit: PreparedPlaylistDescriptionSave;
	  }
	| {
			status: "conflict";
			latestDescription: string | null;
			commit: PreparedPlaylistDescriptionSave;
	  }
	| { status: "reconnect-required" }
	| { status: "extension-required" }
	| { status: "fetch-failed"; errorCode: SpotifyErrorCode };

export async function preparePlaylistDescriptionSave(args: {
	spotifyId: string;
	baselineDescription: string | null;
	nextDescription: string;
}): Promise<PlaylistDescriptionSavePreparationResult> {
	const response = await fetchPlaylistMetadata(
		`spotify:playlist:${args.spotifyId}`,
	);

	if (!response.ok) {
		const outcome = outcomeFromCommandResponse(response);
		if (outcome.status === "reconnect-required") {
			return { status: "reconnect-required" };
		}
		if (outcome.status === "extension-unavailable") {
			return { status: "extension-required" };
		}
		if (outcome.status === "error") {
			return { status: "fetch-failed", errorCode: outcome.errorCode };
		}
		return { status: "fetch-failed", errorCode: "UPSTREAM_ERROR" };
	}

	const commit: PreparedPlaylistDescriptionSave = {
		spotifyId: args.spotifyId,
		nextDescription: args.nextDescription,
		latestMetadata: response.data,
	};

	if (response.data.description !== args.baselineDescription) {
		return {
			status: "conflict",
			latestDescription: response.data.description,
			commit,
		};
	}

	return { status: "ready", commit };
}

export async function commitPlaylistDescriptionSave(
	commit: PreparedPlaylistDescriptionSave,
): Promise<AcknowledgedResult<UpdatePlaylistResult>> {
	return updatePlaylistAcknowledged(commit.spotifyId, {
		name: commit.latestMetadata.name,
		description: commit.nextDescription,
		songCount: commit.latestMetadata.trackCount,
		imageUrl: commit.latestMetadata.imageUrl,
	});
}

export async function syncPreparedPlaylistMetadata(
	commit: PreparedPlaylistDescriptionSave,
): Promise<PreparedPlaylistMetadataSyncResult> {
	try {
		await acknowledgePlaylistUpdate({
			data: {
				spotifyId: commit.spotifyId,
				name: commit.latestMetadata.name,
				description: commit.latestMetadata.description ?? undefined,
				songCount: commit.latestMetadata.trackCount,
				imageUrl: commit.latestMetadata.imageUrl,
			},
		});
		return { ok: true };
	} catch (error) {
		return { ok: false, error };
	}
}

export function outcomeFromCommittedPlaylistDescriptionSave(
	result: AcknowledgedResult<UpdatePlaylistResult>,
) {
	return outcomeFromAcknowledgedResult(result);
}
