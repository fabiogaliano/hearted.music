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
export type JobProgressBase = z.infer<typeof JobProgressBaseSchema>;

export const StageStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
	"skipped",
]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const StageProgressSchema = z.object({
	status: StageStatusSchema,
	succeeded: z.number().int().min(0).default(0),
	failed: z.number().int().min(0).default(0),
});
export type StageProgress = z.infer<typeof StageProgressSchema>;
