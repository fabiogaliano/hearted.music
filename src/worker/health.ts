import { workerConfig } from "./config";

let isHealthy = true;
let isShuttingDown = false;

export function setShuttingDown() {
	isShuttingDown = true;
}

export function setUnhealthy() {
	isHealthy = false;
}

export function startHealthServer() {
	return Bun.serve({
		port: workerConfig.healthPort,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/health") {
				if (!isHealthy || isShuttingDown) {
					return new Response(
						JSON.stringify({
							status: "unhealthy",
							shuttingDown: isShuttingDown,
						}),
						{ status: 503, headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(JSON.stringify({ status: "ok" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("Not Found", { status: 404 });
		},
	});
}
