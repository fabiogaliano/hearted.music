import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentBanner } from "@/components/consent/ConsentBanner";
import type { ResolvedConsent } from "@/lib/consent/consent-policy";
import { render, screen, waitFor } from "@/test/utils/render";
import { ConsentProvider } from "../ConsentProvider";

const posthog = {
	opt_in_capturing: vi.fn(),
	opt_out_capturing: vi.fn(),
	clear_opt_in_out_capturing: vi.fn(),
	startSessionRecording: vi.fn(),
	stopSessionRecording: vi.fn(),
};
vi.mock("@posthog/react", () => ({
	usePostHog: () => posthog,
}));

// The granted path dynamically imports the recorder bundle to self-host replay;
// stub it so tests don't execute the real rrweb IIFE in jsdom.
vi.mock("posthog-js/dist/posthog-recorder", () => ({}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
	},
}));

const enableSentryReplay = vi.fn();
const disableSentryReplay = vi.fn();
vi.mock("@/lib/observability/sentry", () => ({
	enableSentryReplay: () => enableSentryReplay(),
	disableSentryReplay: () => disableSentryReplay(),
}));

const persistMock = vi.fn().mockResolvedValue({ success: true });
vi.mock("@/lib/server/consent.functions", () => ({
	persistConsentDecision: (args: unknown) => persistMock(args),
}));

const readConsentMock = vi.fn();
const writeConsentMock = vi.fn();
const clearConsentMock = vi.fn();
vi.mock("@/lib/consent/consent-storage", () => ({
	readConsent: () => readConsentMock(),
	writeConsent: (status: string) => writeConsentMock(status),
	clearConsent: () => clearConsentMock(),
}));

function renderProvider(args: {
	isAuthenticated: boolean;
	initialConsent: ResolvedConsent | null;
}) {
	return render(
		<ConsentProvider
			isAuthenticated={args.isAuthenticated}
			initialConsent={args.initialConsent}
		>
			<ConsentBanner />
		</ConsentProvider>,
	);
}

const banner = () => screen.queryByRole("dialog");

beforeEach(() => {
	vi.clearAllMocks();
	persistMock.mockResolvedValue({ success: true });
});

describe("ConsentProvider — anonymous (cookie only)", () => {
	it("applies a stored 'granted' cookie and shows no banner", async () => {
		readConsentMock.mockReturnValue("granted");

		renderProvider({ isAuthenticated: false, initialConsent: null });

		await waitFor(() => expect(posthog.opt_in_capturing).toHaveBeenCalled());
		expect(banner()).toBeNull();
		expect(persistMock).not.toHaveBeenCalled();
	});

	it("shows the banner when there is no cookie", async () => {
		readConsentMock.mockReturnValue(null);

		renderProvider({ isAuthenticated: false, initialConsent: null });

		await waitFor(() => expect(banner()).toBeInTheDocument());
		expect(posthog.clear_opt_in_out_capturing).toHaveBeenCalled();
	});

	it("does not persist to the DB on decline when anonymous", async () => {
		readConsentMock.mockReturnValue(null);

		const { user } = renderProvider({
			isAuthenticated: false,
			initialConsent: null,
		});

		await user.click(await screen.findByRole("button", { name: /decline/i }));

		expect(writeConsentMock).toHaveBeenCalledWith("denied");
		expect(persistMock).not.toHaveBeenCalled();
	});
});

describe("ConsentProvider — authenticated (DB authoritative)", () => {
	it("honors valid DB consent, syncs the cookie, and shows no banner", async () => {
		readConsentMock.mockReturnValue(null);

		renderProvider({
			isAuthenticated: true,
			initialConsent: { state: "valid", status: "granted" },
		});

		await waitFor(() => expect(posthog.opt_in_capturing).toHaveBeenCalled());
		expect(writeConsentMock).toHaveBeenCalledWith("granted");
		expect(banner()).toBeNull();
	});

	it("backfills the DB from a valid cookie when no DB decision exists", async () => {
		readConsentMock.mockReturnValue("denied");

		renderProvider({
			isAuthenticated: true,
			initialConsent: { state: "absent" },
		});

		await waitFor(() =>
			expect(persistMock).toHaveBeenCalledWith({ data: { status: "denied" } }),
		);
		expect(posthog.opt_out_capturing).toHaveBeenCalled();
		expect(banner()).toBeNull();
	});

	it("shows the banner when DB is absent and there is no cookie", async () => {
		readConsentMock.mockReturnValue(null);

		renderProvider({
			isAuthenticated: true,
			initialConsent: { state: "absent" },
		});

		await waitFor(() => expect(banner()).toBeInTheDocument());
		expect(posthog.clear_opt_in_out_capturing).toHaveBeenCalled();
		expect(persistMock).not.toHaveBeenCalled();
	});

	it("ignores a stale cookie and re-asks when DB consent is stale", async () => {
		readConsentMock.mockReturnValue("granted");

		renderProvider({
			isAuthenticated: true,
			initialConsent: { state: "stale" },
		});

		await waitFor(() => expect(banner()).toBeInTheDocument());
		expect(clearConsentMock).toHaveBeenCalled();
		expect(posthog.clear_opt_in_out_capturing).toHaveBeenCalled();
		expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
	});

	it("persists the decision to the DB on accept", async () => {
		readConsentMock.mockReturnValue(null);

		const { user } = renderProvider({
			isAuthenticated: true,
			initialConsent: { state: "absent" },
		});

		await user.click(await screen.findByRole("button", { name: /accept/i }));

		await waitFor(() =>
			expect(persistMock).toHaveBeenCalledWith({ data: { status: "granted" } }),
		);
		await waitFor(() =>
			expect(writeConsentMock).toHaveBeenCalledWith("granted"),
		);
	});

	it("shows an error and leaves consent unchanged when authenticated persistence fails", async () => {
		readConsentMock.mockReturnValue(null);
		persistMock.mockRejectedValueOnce(new Error("db down"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		const { user } = renderProvider({
			isAuthenticated: true,
			initialConsent: { state: "absent" },
		});

		await user.click(await screen.findByRole("button", { name: /accept/i }));

		// toast.error is the user-observable failure signal; wait on it instead of
		// the internal console.error message, which no consumer observes.
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"We couldn't save your privacy choice. Your previous setting is still in effect.",
			),
		);
		expect(writeConsentMock).not.toHaveBeenCalled();
		expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
		expect(await screen.findByRole("dialog")).toBeInTheDocument();
		consoleError.mockRestore();
	});
});
