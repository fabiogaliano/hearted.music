#!/usr/bin/env bun
/**
 * Move an account's onboarding step forward or backward.
 *
 * Usage:
 *   bun scripts/set-onboarding-step.ts next
 *   bun scripts/set-onboarding-step.ts prev
 *   bun scripts/set-onboarding-step.ts song-walkthrough
 *   bun scripts/set-onboarding-step.ts next --email other@example.com
 *
 * Default account: sozinhonoroque@gmail.com
 */

import { errorMessage } from "@/lib/shared/errors/error-message";
import { createAdminSupabaseClient } from "@/lib/data/client";

const STEPS = [
	"welcome",
	"pick-color",
	"install-extension",
	"syncing",
	"flag-playlists",
	"pick-demo-song",
	"song-walkthrough",
	"match-walkthrough",
	"plan-selection",
	"complete",
] as const;

const DEFAULT_EMAIL = "sozinhonoroque@gmail.com";

const c = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

function printUsage(): void {
	console.log(`
${c.bold}Set Onboarding Step${c.reset}

${c.cyan}Usage:${c.reset}
  bun scripts/set-onboarding-step.ts <target>
  bun scripts/set-onboarding-step.ts <target> --email <email>

${c.cyan}Target:${c.reset}
  next                  Move one step forward
  prev                  Move one step backward
  <step-name>           Jump to a specific step

${c.cyan}Options:${c.reset}
  --email <email>       Account email (default: ${DEFAULT_EMAIL})
  --list                Show all steps and current position
  --help                Show this help

${c.cyan}Steps:${c.reset}
  ${STEPS.map((s, i) => `${c.dim}${i}${c.reset} ${s}`).join("\n  ")}
`);
}

function parseArgs(argv: string[]): {
	target: "next" | "prev" | string;
	email: string;
	listOnly: boolean;
} {
	const args = argv.slice(2);

	if (args.length === 0 || args.includes("--help")) {
		printUsage();
		process.exit(0);
	}

	if (args.includes("--list")) {
		const emailIdx = args.indexOf("--email");
		const email =
			emailIdx !== -1 ? args[emailIdx + 1] ?? DEFAULT_EMAIL : DEFAULT_EMAIL;
		return { target: "next", email, listOnly: true };
	}

	const emailIdx = args.indexOf("--email");
	const email =
		emailIdx !== -1 ? args[emailIdx + 1] ?? DEFAULT_EMAIL : DEFAULT_EMAIL;

	const positional = args.filter(
		(a, i) => a !== "--email" && args[i - 1] !== "--email",
	);
	const target = positional[0];

	if (!target) {
		printUsage();
		process.exit(1);
	}

	return { target, email, listOnly: false };
}

async function main(): Promise<void> {
	const { target, email, listOnly } = parseArgs(process.argv);

	const supabase = createAdminSupabaseClient();

	const { data: account, error: accountError } = await supabase
		.from("account")
		.select("id, email, display_name")
		.eq("email", email)
		.maybeSingle();

	if (accountError) throw new Error(`Account lookup failed: ${accountError.message}`);
	if (!account) throw new Error(`No account found for ${email}`);

	const { data: prefs, error: prefsError } = await supabase
		.from("user_preferences")
		.select("onboarding_step, onboarding_completed_at")
		.eq("account_id", account.id)
		.maybeSingle();

	if (prefsError) throw new Error(`Preferences lookup failed: ${prefsError.message}`);

	const currentStep = (prefs?.onboarding_step as string) ?? "welcome";
	const currentIdx = STEPS.indexOf(currentStep as (typeof STEPS)[number]);

	if (listOnly) {
		console.log(
			`\n${c.bold}${account.display_name ?? account.email}${c.reset} ${c.dim}(${account.id})${c.reset}\n`,
		);
		for (let i = 0; i < STEPS.length; i++) {
			const marker = i === currentIdx ? `${c.green}→${c.reset}` : " ";
			const label =
				i === currentIdx
					? `${c.bold}${STEPS[i]}${c.reset}`
					: `${c.dim}${STEPS[i]}${c.reset}`;
			console.log(`  ${marker} ${c.dim}${i}${c.reset} ${label}`);
		}
		console.log();
		return;
	}

	let newStep: string;

	if (target === "next") {
		if (currentIdx >= STEPS.length - 1) {
			console.log(`${c.yellow}Already at last step (${currentStep})${c.reset}`);
			return;
		}
		newStep = STEPS[currentIdx + 1]!;
	} else if (target === "prev") {
		if (currentIdx <= 0) {
			console.log(
				`${c.yellow}Already at first step (${currentStep})${c.reset}`,
			);
			return;
		}
		newStep = STEPS[currentIdx - 1]!;
	} else {
		if (!STEPS.includes(target as (typeof STEPS)[number])) {
			console.log(`${c.red}Unknown step: ${target}${c.reset}`);
			console.log(`Valid steps: ${STEPS.join(", ")}`);
			process.exit(1);
		}
		newStep = target;
	}

	const isComplete = newStep === "complete";

	const { error: updateError } = await supabase
		.from("user_preferences")
		.update({
			onboarding_step: newStep,
			onboarding_completed_at: isComplete ? new Date().toISOString() : null,
		})
		.eq("account_id", account.id);

	if (updateError) throw new Error(`Update failed: ${updateError.message}`);

	const newIdx = STEPS.indexOf(newStep as (typeof STEPS)[number]);
	const direction =
		newIdx > currentIdx ? "→" : newIdx < currentIdx ? "←" : "=";

	console.log(
		`\n${c.green}✓${c.reset} ${c.dim}${account.email}${c.reset}`,
	);
	console.log(
		`  ${c.dim}${currentIdx}${c.reset} ${currentStep} ${direction} ${c.bold}${newStep}${c.reset} ${c.dim}${newIdx}${c.reset}`,
	);
	if (isComplete) {
		console.log(`  ${c.dim}onboarding_completed_at set${c.reset}`);
	}
	console.log();
}

main().catch((err: unknown) => {
	const message = errorMessage(err);
	console.error(`${c.red}✗${c.reset} ${message}`);
	process.exit(1);
});
