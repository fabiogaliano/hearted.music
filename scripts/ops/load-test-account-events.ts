import { readFileSync } from "node:fs";
import type { EventTokenClaims } from "@/lib/account-events/contract";
import { signEventToken } from "@/lib/account-events/token";

const TARGET_TABS = process.env.TARGET_TABS
	? parseInt(process.env.TARGET_TABS, 10)
	: 1000;
const GATEWAY_URL =
	process.env.GATEWAY_URL ||
	"http://localhost:3003/account-events/stream";
const DURATION_SECONDS = process.env.DURATION_SECONDS
	? parseInt(process.env.DURATION_SECONDS, 10)
	: 60;
const RECONNECT_CHURN_PERCENT = 0.05;
const TOKENS_FILE = process.env.ACCOUNT_EVENTS_TOKENS_FILE;
const TOKENS_INLINE = process.env.ACCOUNT_EVENTS_TOKENS;

let activeConnections = 0;
let totalMessages = 0;
let errors = 0;

interface LoadTestClient {
	disconnect: () => void;
	reconnect: () => void;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadProvidedTokens(): string[] {
	if (TOKENS_FILE) {
		return readFileSync(TOKENS_FILE, "utf8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	if (TOKENS_INLINE) {
		return TOKENS_INLINE.split(",")
			.map((token) => token.trim())
			.filter((token) => token.length > 0);
	}

	return [];
}

async function buildLocalToken(id: number): Promise<string> {
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + 5 * 60;

	const claims: EventTokenClaims = {
		sub: `load-test-account-${Math.floor(id / 5)}`,
		sid: `load-test-session-${id}`,
		ver: 1,
		iat,
		exp,
		jti: crypto.randomUUID(),
	};

	return signEventToken(claims);
}

async function resolveTokens(): Promise<string[]> {
	const providedTokens = loadProvidedTokens();
	if (providedTokens.length > 0) {
		return providedTokens;
	}

	const generatedTokens: string[] = [];
	for (let id = 0; id < TARGET_TABS; id++) {
		generatedTokens.push(await buildLocalToken(id));
	}
	return generatedTokens;
}

function classifyError(error: unknown): string {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return String(error);
}

async function createClient(token: string): Promise<LoadTestClient> {
	let abortController = new AbortController();

	async function connect() {
		activeConnections++;
		try {
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
				return;
			}

			if (!response.body) {
				console.error("HTTP Error: stream body missing");
				errors++;
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value, { stream: true });
				if (chunk.includes(": ping") || chunk.includes("event:")) {
					totalMessages++;
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}
			console.error("Connection error:", classifyError(error));
			errors++;
		} finally {
			activeConnections--;
		}
	}

	void connect();

	return {
		disconnect: () => {
			abortController.abort();
		},
		reconnect: () => {
			abortController.abort();
			abortController = new AbortController();
			void connect();
		},
	};
}

async function runTest() {
	const tokens = await resolveTokens();
	const usingProvidedTokens = loadProvidedTokens().length > 0;

	console.log(
		`Starting load test with ${TARGET_TABS} target concurrent tabs...`,
	);
	console.log(`Targeting ${GATEWAY_URL}`);
	console.log(
		usingProvidedTokens
			? `Using ${tokens.length} pre-minted event token(s).`
			: "Using locally signed synthetic tokens.",
	);

	const clients: LoadTestClient[] = [];

	console.log("Ramping up connections...");
	const rampUpBatchSize = 100;
	for (let i = 0; i < TARGET_TABS; i += rampUpBatchSize) {
		const batch = Math.min(rampUpBatchSize, TARGET_TABS - i);
		for (let j = 0; j < batch; j++) {
			const clientId = i + j;
			const token = tokens[clientId % tokens.length];
			clients.push(await createClient(token));
		}
		await sleep(100);
	}

	console.log(`Ramp up complete. ${activeConnections} connections active.`);

	const startTime = Date.now();
	while ((Date.now() - startTime) / 1000 < DURATION_SECONDS) {
		console.log(
			`[Status] Active: ${activeConnections} | Errors: ${errors} | Msgs Rx: ${totalMessages}`,
		);

		const churnCount = Math.floor(
			(TARGET_TABS * RECONNECT_CHURN_PERCENT * 5) / 60,
		);
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

runTest().catch((error) => {
	console.error(classifyError(error));
	process.exit(1);
});
