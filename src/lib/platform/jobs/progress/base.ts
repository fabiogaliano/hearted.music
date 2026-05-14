/**
 * Shared progress primitives for all library-processing job types.
 */

import { z } from "zod";

export const JobProgressBaseSchema = z.object({
	total: z.number().int().min(0),
	done: z.number().int().min(0),
	succeeded: z.number().int().min(0),
	failed: z.number().int().min(0),
});

const StageStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
	"skipped",
]);

export const StageProgressSchema = z.object({
	status: StageStatusSchema,
	succeeded: z.number().int().min(0).default(0),
	failed: z.number().int().min(0).default(0),
});
