import { z } from "zod";

/**
 * Where to send someone after they sign in from a deep link. Same-origin paths
 * only: browsers treat "//host" and "/\host" as protocol-relative, which would
 * turn the login page into an open redirect. An invalid value is dropped, not
 * an error, so a mangled link still reaches the page.
 */
export const returnPathSchema = z
	.string()
	.max(2048)
	.regex(/^\/(?![/\\])/)
	.optional()
	.catch(undefined);
