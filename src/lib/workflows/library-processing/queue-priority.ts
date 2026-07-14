import type { QueueBand } from "@/lib/shared/queue/band";

const BAND_VALUES: Record<QueueBand, number> = {
	low: 0,
	standard: 50,
	priority: 100,
	interactive: 200,
};

export function bandToNumeric(band: QueueBand): number {
	return BAND_VALUES[band];
}
