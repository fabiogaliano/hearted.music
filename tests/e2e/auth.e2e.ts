/**
 * End-to-end auth suite (email/password + Google coexistence).
 *
 * Two layers, both against the LIVE local stack:
 *   1. API + DB — drives /api/auth/* and asserts database side effects
 *      (scrypt hashing, session revocation, email_verified, app-account hook).
 *   2. Browser UI — Playwright drives the real /login flows (collapsible,
 *      autofocus, sign-in/up navigation, forgot-password, unverified banner).
 *
 * Prereqs: `supabase start` + `bun run dev` (see tests/e2e/README.md).
 * Run:     `bun run test:e2e`
 */

import { createEmailVerificationToken } from "better-auth/api";
import { chromium } from "playwright";
import {
	BASE_URL,
	cleanupTestUsers,
	closeDb,
	db,
	makeClient,
	makeReporter,
	probeServer,
} from "./lib";

const r = makeReporter();
const STAMP = Date.now();
const apiEmail = `e2e-api-${STAMP}@hearted.test`;
const uiEmail = `e2e-ui-${STAMP}@hearted.test`;
const PW = "Sup3rSecret!23";
const NEW_PW = "BrandN3wPass!99";

async function apiAndDbChecks() {
	const sql = db();
	const client = makeClient();

	// sign-up
	const signup = await client.fetchJson("/api/auth/sign-up/email", {
		method: "POST",
		body: { email: apiEmail, password: PW, name: "E2E Reader" },
	});
	r.ok("signup returns 200", signup.status === 200, `status ${signup.status}`);
	r.ok("signup sets session cookie (autoSignIn)", client.cookieCount() > 0);
	r.ok(
		"new user is unverified",
		(signup.json as any)?.user?.emailVerified === false,
	);

	// DB: credential account + password hash + new column + app-account hook
	const [acct] = await sql`
		SELECT provider_id, (password IS NOT NULL) AS has_password,
		       length(password) AS pw_len
		FROM oauth_account
		WHERE user_id = (SELECT id FROM "user" WHERE email = ${apiEmail})
		  AND provider_id = 'credential'`;
	r.ok("credential row exists", acct?.provider_id === "credential");
	r.ok("password stored as hash, not plaintext", acct?.has_password && Number(acct.pw_len) > 100);
	const cols = await sql`
		SELECT column_name FROM information_schema.columns
		WHERE table_name = 'oauth_account' AND column_name = 'refresh_token_expires_at'`;
	r.ok("refresh_token_expires_at column present", cols.length === 1);
	const [appAcct] = await sql`SELECT display_name FROM account WHERE email = ${apiEmail}`;
	r.ok("app account row created by hook", appAcct?.display_name === "E2E Reader");

	// sign-in while unverified (soft verification allows it)
	const signin = await makeClient().fetchJson("/api/auth/sign-in/email", {
		method: "POST",
		body: { email: apiEmail, password: PW },
	});
	r.ok("unverified user can sign in (soft verification)", signin.status === 200);

	// negatives
	const wrongPw = await makeClient().fetchJson("/api/auth/sign-in/email", {
		method: "POST",
		body: { email: apiEmail, password: "totally-wrong" },
	});
	r.ok("wrong password rejected (401)", wrongPw.status === 401);
	const noCred = await makeClient().fetchJson("/api/auth/sign-in/email", {
		method: "POST",
		body: { email: `ghost-${STAMP}@hearted.test`, password: "whatever123" },
	});
	r.ok("no-credential email rejected with same generic 401", noCred.status === 401);

	// password reset + session revocation
	const [{ sessions: sessionsBefore }] = await sql`
		SELECT count(*)::int AS sessions FROM "session"
		WHERE user_id = (SELECT id FROM "user" WHERE email = ${apiEmail})`;
	const [{ password: pwBefore }] = await sql`
		SELECT password FROM oauth_account
		WHERE user_id = (SELECT id FROM "user" WHERE email = ${apiEmail}) AND provider_id='credential'`;
	const reqReset = await makeClient().fetchJson("/api/auth/request-password-reset", {
		method: "POST",
		body: { email: apiEmail, redirectTo: "/reset-password" },
	});
	r.ok("request-password-reset returns 200", reqReset.status === 200);
	const [resetRow] = await sql`
		SELECT identifier FROM verification
		WHERE identifier LIKE 'reset-password:%' ORDER BY created_at DESC LIMIT 1`;
	const token = String(resetRow?.identifier ?? "").replace("reset-password:", "");
	r.ok("reset token persisted in verification table", token.length > 0);
	const doReset = await makeClient().fetchJson("/api/auth/reset-password", {
		method: "POST",
		body: { newPassword: NEW_PW, token },
	});
	r.ok("reset-password returns 200", doReset.status === 200);
	const [{ password: pwAfter }] = await sql`
		SELECT password FROM oauth_account
		WHERE user_id = (SELECT id FROM "user" WHERE email = ${apiEmail}) AND provider_id='credential'`;
	r.ok("password hash changed after reset", pwBefore !== pwAfter);
	const [{ sessions: sessionsAfter }] = await sql`
		SELECT count(*)::int AS sessions FROM "session"
		WHERE user_id = (SELECT id FROM "user" WHERE email = ${apiEmail})`;
	r.ok("sessions revoked on reset", Number(sessionsBefore) > 0 && Number(sessionsAfter) === 0,
		`before=${sessionsBefore} after=${sessionsAfter}`);
	const oldPw = await makeClient().fetchJson("/api/auth/sign-in/email", {
		method: "POST", body: { email: apiEmail, password: PW },
	});
	r.ok("old password rejected after reset (401)", oldPw.status === 401);
	const newPw = await makeClient().fetchJson("/api/auth/sign-in/email", {
		method: "POST", body: { email: apiEmail, password: NEW_PW },
	});
	r.ok("new password accepted after reset (200)", newPw.status === 200);

	// email verification: mint a real token, hit the endpoint
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		r.ok("BETTER_AUTH_SECRET available for verify test", false);
	} else {
		const vToken = await createEmailVerificationToken(secret, apiEmail);
		const verifyRes = await fetch(
			`${BASE_URL}/api/auth/verify-email?token=${vToken}&callbackURL=%2Fverify-email`,
			{ headers: { Origin: BASE_URL }, redirect: "manual" },
		);
		r.ok("verify-email redirects (302) on valid token", verifyRes.status === 302);
		const [{ email_verified }] = await sql`SELECT email_verified FROM "user" WHERE email = ${apiEmail}`;
		r.ok("email_verified flips to true", email_verified === true);
		const badVerify = await fetch(
			`${BASE_URL}/api/auth/verify-email?token=garbage&callbackURL=%2Fverify-email`,
			{ headers: { Origin: BASE_URL }, redirect: "manual" },
		);
		const loc = badVerify.headers.get("location") ?? "";
		r.ok("verify-email error path redirects with ?error", loc.includes("error="), loc);
	}
}

async function uiChecks() {
	const browser = await chromium.launch({ headless: true });
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	page.setDefaultTimeout(15000);

	const freshLogin = async () => {
		await ctx.clearCookies();
		await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
		await page.waitForSelector("text=Continue with Google");
	};
	// Rides out the SSR hydration race: click until the panel actually expands.
	const expandCredentials = async () => {
		const btn = page.locator('button:has-text("Use email and password")');
		await btn.waitFor();
		for (let i = 0; i < 25; i++) {
			await btn.click().catch(() => {});
			try {
				await page.waitForSelector("#email", { timeout: 800 });
				return;
			} catch {}
		}
		throw new Error("credentials panel never expanded");
	};
	const goneSoon = (sel: string) =>
		page.waitForSelector(sel, { state: "detached", timeout: 3000 }).then(() => true).catch(() => false);

	try {
		// choice panel
		await freshLogin();
		r.ok("ui: Google button visible", await page.locator("text=Continue with Google").isVisible());
		r.ok("ui: email trigger visible", await page.locator("text=Use email and password").isVisible());
		r.ok("ui: credentials form hidden initially", (await page.locator("#email").count()) === 0);

		// expand + autofocus
		await expandCredentials();
		r.ok("ui: email field appears on expand", await page.locator("#email").isVisible());
		r.ok("ui: password field appears on expand", await page.locator("#password").isVisible());
		r.ok("ui: Google hidden when expanded", await goneSoon("text=Continue with Google"));
		const focusedId = await page.evaluate(() => (document.activeElement as HTMLElement)?.id || "");
		r.ok("ui: autofocus lands on #email", focusedId === "email", `activeElement=#${focusedId}`);

		// collapse
		await page.locator("text=Use Google instead").click();
		await page.waitForSelector("text=Continue with Google");
		r.ok("ui: collapse restores Google view", await page.locator("text=Continue with Google").isVisible());
		r.ok("ui: collapse removes password field", await goneSoon("#password"));

		// sign-in via UI (apiEmail is verified + NEW_PW after the API section)
		await expandCredentials();
		await page.fill("#email", apiEmail);
		await page.fill("#password", NEW_PW);
		await page.locator('button[type="submit"]:has-text("Continue")').click();
		await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
		r.ok("ui: sign-in navigates away from /login", !new URL(page.url()).pathname.startsWith("/login"),
			`landed on ${new URL(page.url()).pathname}`);
		r.ok("ui: no unverified banner for verified user", (await page.locator("text=secure your account").count()) === 0);

		// forgot-password (client-nav path → single click, button disables while submitting)
		await freshLogin();
		await expandCredentials();
		await page.locator("text=Forgot?").click();
		await page.waitForURL((u) => u.pathname === "/forgot-password", { timeout: 10000 }).catch(() => {});
		r.ok("ui: Forgot? routes to /forgot-password", new URL(page.url()).pathname === "/forgot-password");
		// Retry until the reset POST actually fires (rides out hydration; a
		// pre-hydration click falls back to a native GET that clears the field).
		for (let i = 0; i < 12; i++) {
			await page.waitForSelector("#email");
			await page.fill("#email", apiEmail);
			const respP = page
				.waitForResponse((rsp) => rsp.url().includes("/api/auth/request-password-reset"), { timeout: 1500 })
				.then(() => true)
				.catch(() => false);
			await page.locator('button[type="submit"]').click().catch(() => {});
			if (await respP) break;
		}
		const confirm = await page.waitForSelector("text=Check your inbox", { timeout: 8000 }).then(() => true).catch(() => false);
		r.ok("ui: forgot-password shows confirmation", confirm);

		// sign-up via UI → unverified banner
		await freshLogin();
		await expandCredentials();
		await page.locator("text=Create an account").click();
		await page.waitForSelector("#name");
		await page.fill("#name", "UI Reader");
		await page.fill("#email", uiEmail);
		await page.fill("#password", PW);
		await page.locator('button[type="submit"]:has-text("Create account")').click();
		await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
		r.ok("ui: sign-up navigates away from /login", !new URL(page.url()).pathname.startsWith("/login"),
			`landed on ${new URL(page.url()).pathname}`);
		const banner = await page.waitForSelector("text=secure your account", { timeout: 12000 }).then(() => true).catch(() => false);
		r.ok("ui: unverified banner shows for new signup", banner);
	} finally {
		await browser.close();
	}
}

async function main() {
	await probeServer();
	console.log("\n── API + DB ──");
	await apiAndDbChecks();
	console.log("\n── Browser UI ──");
	await uiChecks();

	const { failed } = r.summary();
	await cleanupTestUsers();
	console.log("cleaned up e2e test users");
	await closeDb();
	process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
	console.error("E2E run crashed:", e);
	try {
		await cleanupTestUsers();
	} catch {}
	await closeDb();
	process.exit(1);
});
