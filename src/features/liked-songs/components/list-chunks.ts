/**
 * Splits rows into content-visibility chunks whose boundaries sit at fixed
 * offsets from an origin row rather than from the top: chunk k holds rows
 * [originIndex + k·size, originIndex + (k+1)·size). Rows inserted above the
 * origin (a new like at the head, a page prepended on a deep link) only start
 * or grow the topmost chunk, so every other chunk keeps its rows and key. A row
 * that moved to another chunk element would remount and lose focus.
 */
export function chunkAroundOrigin<T>(
	items: readonly T[],
	originIndex: number,
	size: number,
): { key: number; items: T[] }[] {
	const chunks: { key: number; items: T[] }[] = [];
	let start = 0;
	while (start < items.length) {
		const key = Math.floor((start - originIndex) / size);
		const end = Math.min(items.length, originIndex + (key + 1) * size);
		chunks.push({ key, items: items.slice(start, end) });
		start = end;
	}
	return chunks;
}
