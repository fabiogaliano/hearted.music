import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { captureServerError } from "@/lib/observability/capture-server-error";

// Thrown as control flow, not failures.
function isControlFlow(error: unknown): boolean {
	return isRedirect(error) || isNotFound(error);
}

// Start serialises a throwing server fn into its response, so the error never
// reaches the request layer or the server entry; only function middleware sees
// it. Kept separate from the request middleware below because Start skips a
// function middleware already run at request level.
export const serverFnErrorMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next, serverFnMeta }) => {
	try {
		return await next();
	} catch (error) {
		if (!isControlFlow(error)) {
			captureServerError(error, {
				area: "server_fn",
				// SSR-side calls carry only the id.
				operation: serverFnMeta.name || serverFnMeta.id,
				extra: { filename: serverFnMeta.filename },
			});
		}
		throw error;
	}
});

export const requestErrorMiddleware = createMiddleware().server(
	async ({ next, pathname, handlerType }) => {
		try {
			return await next();
		} catch (error) {
			if (!isControlFlow(error)) {
				captureServerError(error, {
					area: "request",
					operation: handlerType,
					extra: { pathname },
				});
			}
			throw error;
		}
	},
);
