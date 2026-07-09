import { signEventToken } from "@/lib/account-events/token";
import type { EventTokenClaims } from "@/lib/account-events/contract";

const TARGET_TABS = process.env.TARGET_TABS ? parseInt(process.env.TARGET_TABS, 10) : 1000;
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3000/account-events/stream";
const DURATION_SECONDS = process.env.DURATION_SECONDS ? parseInt(process.env.DURATION_SECONDS, 10) : 60;
const RECONNECT_CHURN_PERCENT = 0.05; // 5% of connections randomly drop and reconnect per minute

let activeConnections = 0;
let totalMessages = 0;
let errors = 0;

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createClient(id: number) {
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + 5 * 60; // 5 mins

	const claims: EventTokenClaims = {
		sub: `load-test-account-${Math.floor(id / 5)}`, // Simulate ~5 tabs per account
		sid: `load-test-session-${id}`,
		ver: 1,
		iat,
		exp,
		jti: crypto.randomUUID(),
	};

	const token = await signEventToken(claims);
	let abortController = new AbortController();

	async function connect() {
		try {
			activeConnections++;
			const response = await fetch(GATEWAY_URL, {
				headers: {
					Accept: "text/event-stream",
					Authorization: `Bearer ${token}`,
				},
				signal: abortController.signal,
			});

			if (!response.ok) {
				console.error(`HTTP Error: ${response.status} ${response.statusText}`);
				errors++;
				activeConnections--;
				return;
			}

			if (response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const chunk = decoder.decode(value);
					if (chunk.includes("ping") || chunk.includes("event:")) {
						totalMessages++;
					}
				}
			}
		} catch (err: any) {
			if (err.name !== "AbortError") {
				console.error("Connection error:", err);
				errors++;
			}
		} finally {
			activeConnections--;
		}
	}

	connect();

	return {
		disconnect: () => {
			abortController.abort();
		},
		reconnect: () => {
			abortController.abort();
			abortController = new AbortController();
			connect();
		},
	};
}

async function runTest() {
	console.log(`Starting load test with ${TARGET_TABS} target concurrent tabs...`);
	console.log(`Targeting ${GATEWAY_URL}`);

	const clients: any[] = [];

	// Ramp up connections
	console.log("Ramping up connections...");
	const rampUpBatchSize = 100;
	for (let i = 0; i < TARGET_TABS; i += rampUpBatchSize) {
		const batch = Math.min(rampUpBatchSize, TARGET_TABS - i);
		for (let j = 0; j < batch; j++) {
			clients.push(await createClient(i + j));
		}
		await sleep(100); // 100ms between batches of 100
	}

	console.log(`Ramp up complete. ${activeConnections} connections active.`);

	const startTime = Date.now();
	
	// Simulation loop
	while ((Date.now() - startTime) / 1000 < DURATION_SECONDS) {
		console.log(`[Status] Active: ${activeConnections} | Errors: ${errors} | Msgs Rx: ${totalMessages}`);
		
		// Simulate churn
		const churnCount = Math.floor(TARGET_TABS * RECONNECT_CHURN_PERCENT / 60 * 5); // 5 sec interval churn
		for (let i = 0; i < churnCount; i++) {
			const randomClient = clients[Math.floor(Math.random() * clients.length)];
			randomClient.reconnect();
		}

		await sleep(5000);
	}

	console.log("Test duration complete. Tearing down...");
	for (const client of clients) {
		client.disconnect();
	}

	console.log("--- Results ---");
	console.log(`Target Tabs: ${TARGET_TABS}`);
	console.log(`Duration: ${DURATION_SECONDS}s`);
	console.log(`Total Errors: ${errors}`);
	console.log(`Total Messages Received: ${totalMessages}`);
	process.exit(0);
}

runTest().catch(console.error);
