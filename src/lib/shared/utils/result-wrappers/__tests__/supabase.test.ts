import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fromSupabaseRpc } from "../supabase";

const RowSchema = z.object({
	id: z.string(),
	score: z.number(),
});
const RowsSchema = z.array(RowSchema);

describe("fromSupabaseRpc", () => {
	it("returns Result.ok with the parsed rows on a valid payload", async () => {
		const result = await fromSupabaseRpc(
			RowsSchema,
			Promise.resolve({
				data: [{ id: "row-1", score: 0.5 }],
				error: null,
			}),
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual([{ id: "row-1", score: 0.5 }]);
		}
	});

	it("treats a null data payload as an empty row set", async () => {
		const result = await fromSupabaseRpc(
			RowsSchema,
			Promise.resolve({ data: null, error: null }),
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual([]);
		}
	});

	it("maps a PostgREST error via the shared error mapper", async () => {
		const result = await fromSupabaseRpc(
			RowsSchema,
			Promise.resolve({
				data: null,
				error: { code: "PGRST301", message: "boom" },
			}),
		);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
		}
	});

	it("returns a DatabaseError with code rpc_shape_mismatch on a parse failure, not a throw", async () => {
		const result = await fromSupabaseRpc(
			RowsSchema,
			Promise.resolve({
				// Missing the required `score` field — a schema-mismatched RPC payload.
				data: [{ id: "row-1" }],
				error: null,
			}),
		);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
			expect(result.error).toMatchObject({ code: "rpc_shape_mismatch" });
		}
	});
});
