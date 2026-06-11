/**
 * Shape of table.json after stripping _meta.
 * Each key is a canonical genre name; value is a sparse neighbor → sim map.
 */
export type SimilarityTable = Record<string, Record<string, number>>;
