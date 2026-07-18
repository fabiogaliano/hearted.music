// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	type EmailDraft,
	isDraftEmpty,
	readEmailDraft,
	readEmailHistoryDraft,
	rememberEmailHistoryDraft,
	writeEmailDraft,
} from "../email-draft";

const draft: EmailDraft = {
	subject: "Hello",
	headline: "Hi",
	body: "A private body",
	ctaLabel: "Open",
	ctaUrl: "https://hearted.music",
	preheader: "Preview",
	footnote: "— hearted",
};

describe("email draft storage", () => {
	beforeEach(() => window.localStorage.clear());

	it("restores a draft and selected template", () => {
		writeEmailDraft({ draft, templateId: "gift-500-unlocks" });
		expect(readEmailDraft()).toEqual({
			draft,
			templateId: "gift-500-unlocks",
		});
	});

	it("rejects malformed stored values and detects empty drafts", () => {
		window.localStorage.setItem(
			"hearted-control-panel.email-draft.v1",
			JSON.stringify({ draft: { body: 4 }, templateId: "template" }),
		);
		expect(readEmailDraft()).toBeNull();
		expect(
			isDraftEmpty({
				subject: "",
				headline: "",
				body: "",
				ctaLabel: "",
				ctaUrl: "",
				preheader: "",
				footnote: "",
			}),
		).toBe(true);
	});

	it("keeps duplicate-able bodies in browser-only history storage", () => {
		rememberEmailHistoryDraft("run-1", { draft, templateId: null });
		expect(readEmailHistoryDraft("run-1")).toEqual({
			draft,
			templateId: null,
		});
	});
});
