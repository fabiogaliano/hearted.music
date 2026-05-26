import { describe, expect, it } from "vitest";
import { Route } from "../health";

// TanStack's Route handler types don't narrow cleanly; cast to the shape we
// invoke. Handlers live under Route.options.server.
type HealthRoute = {
	options: { server: { handlers: { GET: () => Response } } };
};

describe("/health", () => {
	it("returns 200 with a liveness payload", async () => {
		const route = Route as unknown as HealthRoute;
		const response = route.options.server.handlers.GET();

		expect(response.status).toBe(200);
		const body = (await response.json()) as { status: string };
		expect(body.status).toBe("ok");
	});
});
