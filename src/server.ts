import { captureException } from "@sentry/core";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

export default createServerEntry({
	async fetch(request: Request) {
		try {
			return await handler.fetch(request);
		} catch (err) {
			captureException(err, { tags: { source: "server-entry" } });
			throw err;
		}
	},
});
