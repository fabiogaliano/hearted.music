/**
 * Checks a server process runs once before it serves traffic or claims jobs.
 * Callers treat an error as fatal and exit.
 */

import { Result, TaggedError } from "better-result";
import { getStoredSongEmbeddingSpaces } from "@/lib/domains/enrichment/embeddings/queries";
import { getMlProvider } from "@/lib/integrations/providers/factory";
import type { DbError } from "@/lib/shared/errors/database";
import type {
	MLConfigError,
	MLProviderUnavailableError,
} from "@/lib/shared/errors/domain/ml";

interface EmbeddingSpace {
	model: string;
	dims: number;
}

export class EmbeddingSpaceMismatchError extends TaggedError(
	"EmbeddingSpaceMismatchError",
)<{ provider: EmbeddingSpace; stored: EmbeddingSpace[]; message: string }> {
	constructor(provider: EmbeddingSpace, stored: EmbeddingSpace[]) {
		const describe = ({ model, dims }: EmbeddingSpace) => `${model}/${dims}`;
		super({
			provider,
			stored,
			message: `ML provider embeds with ${describe(provider)} but song_embedding holds ${stored.map(describe).join(", ")}`,
		});
	}
}

/**
 * Vectors from different models (or sizes) score as noise against each other,
 * so a process whose provider disagrees with any stored vector would silently
 * corrupt matching. An empty table — a fresh database — agrees with anything.
 */
export function checkEmbeddingSpace(
	provider: EmbeddingSpace,
	stored: EmbeddingSpace[],
): Result<void, EmbeddingSpaceMismatchError> {
	const matches = stored.every(
		(space) => space.model === provider.model && space.dims === provider.dims,
	);
	if (matches) return Result.ok(undefined);
	return Result.err(new EmbeddingSpaceMismatchError(provider, stored));
}

/** The configured ML provider exists and embeds into the stored vector space. */
export async function checkEmbeddingProvider(): Promise<
	Result<
		void,
		| MLConfigError
		| MLProviderUnavailableError
		| DbError
		| EmbeddingSpaceMismatchError
	>
> {
	const provider = getMlProvider();
	if (Result.isError(provider)) return Result.err(provider.error);
	const { embeddingModel, embeddingDims } = provider.value.getMetadata();

	const stored = await getStoredSongEmbeddingSpaces();
	if (Result.isError(stored)) return Result.err(stored.error);

	return checkEmbeddingSpace(
		{ model: embeddingModel, dims: embeddingDims },
		stored.value,
	);
}
