export function exportFilename(section: string, productionRef: string, extension: "csv" | "json"): string {
	const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
	const ref = productionRef.replace(/[^a-zA-Z0-9_-]/g, "_");
	return `${section}-${ref}-${timestamp}.${extension}`;
}

const FORMULA_PREFIX = /^[=+\-@]/;

export function escapeCsvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	const text =
		typeof value === "string" || typeof value === "number" || typeof value === "boolean"
			? String(value)
			: (JSON.stringify(value) ?? "");
	const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
	return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
	return [
		headers.map((header) => escapeCsvCell(header)).join(","),
		...rows.map((row) => row.map((value) => escapeCsvCell(value)).join(",")),
	].join("\n");
}

export function exportResponse(
	filename: string,
	content: string,
	contentType: "csv" | "json",
): Response {
	return new Response(content, {
		status: 200,
		headers: {
			"Content-Type": contentType === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	});
}
