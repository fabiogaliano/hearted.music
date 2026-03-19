/**
 * Disposable script to test GEMINI_API_KEY connectivity.
 * Usage: bun scripts/test-gemini-key.ts
 */

const key = process.env.GEMINI_API_KEY;

console.log(`GEMINI_API_KEY: ${key ? `${key.slice(0, 10)}...${key.slice(-4)}` : "NOT SET"}`);

if (!key) {
	console.error("No GEMINI_API_KEY found in environment. Set it in .env");
	process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

const res = await fetch(url, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		contents: [{ parts: [{ text: "Say hello in exactly 3 words." }] }],
	}),
});

const body = await res.json();

if (res.ok) {
	const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
	console.log(`Status: ${res.status} OK`);
	console.log(`Response: ${text}`);
} else {
	console.error(`Status: ${res.status} ${res.statusText}`);
	console.error(JSON.stringify(body.error, null, 2));
}
