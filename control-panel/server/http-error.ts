/**
 * Minimal HTTP error for control-panel server actions. Throwing one lets the
 * request handler map a failure to a real status code (400 invalid input, 404
 * missing row, …) instead of collapsing everything into a generic 500.
 */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}
