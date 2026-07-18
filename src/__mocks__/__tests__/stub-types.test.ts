/**
 * Type-level coverage for the Ladle stubs' input-type re-exports.
 *
 * The Ladle Vite alias (ladle-vite.config.ts) swaps these real server-function
 * modules for their __mocks__ counterparts at bundle time, but there is no
 * matching tsconfig `paths` entry — so `tsc` always resolves the real module,
 * never the stub. That's what makes a hand-copied type a silent trap: it type-
 * checks fine (nothing points at the stub's declaration) while the Ladle
 * runtime — which DOES load the stub — drifts from the checked contract.
 *
 * These assertions cover the two stub callables whose *input* parameter type
 * is a genuine, unmodified `import type` of the real module's input type
 * (as opposed to a locally reconstructed shape) — confirming there is no
 * second, drifting copy of the type sitting between the import and the call
 * site. Output/result literals are already guarded in-place by `satisfies`
 * at their construction site in each stub file, so they aren't retested here.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { CreatePlaylistFromDraftInput } from "@/lib/extension/create-playlist-from-draft";
import type { SavePlaylistMatchConfigInput } from "@/lib/server/playlists.functions";
import type {
	createPlaylistFromDraft,
	resumePlaylistCreateFromDraft,
} from "../create-playlist-from-draft.stub";
import type { savePlaylistMatchConfig } from "../playlists.functions.stub";

describe("create-playlist-from-draft.stub input-type re-export", () => {
	it("createPlaylistFromDraft takes the real module's CreatePlaylistFromDraftInput, not a copy", () => {
		expectTypeOf<
			Parameters<typeof createPlaylistFromDraft>[0]
		>().toEqualTypeOf<CreatePlaylistFromDraftInput>();
	});

	it("resumePlaylistCreateFromDraft's draft-input parameter matches the same real type", () => {
		expectTypeOf<
			Parameters<typeof resumePlaylistCreateFromDraft>[0]
		>().toEqualTypeOf<CreatePlaylistFromDraftInput>();
	});
});

describe("playlists.functions.stub input-type re-export", () => {
	it("savePlaylistMatchConfig's data payload matches the real module's SavePlaylistMatchConfigInput", () => {
		expectTypeOf<
			Parameters<typeof savePlaylistMatchConfig>[0]["data"]
		>().toEqualTypeOf<SavePlaylistMatchConfigInput>();
	});
});
