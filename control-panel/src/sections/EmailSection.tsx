import { PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccountPicker } from "../components/AccountPicker";
import { BatchLauncher } from "../components/BatchLauncher";
import { ConfirmModal } from "../components/ConfirmModal";
import { Card } from "../components/primitives";
import { postJson } from "../lib/api";
import { type EmailTestResult, sendEmailTest } from "../lib/batch";
import {
	type EmailDraft,
	isDraftEmpty,
	readEmailDraft,
	readEmailHistoryDraft,
	rememberEmailHistoryDraft,
	writeEmailDraft,
} from "../lib/email-draft";
import { noAutofill } from "../lib/form";
import type { AccountSearchResult } from "../lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY: EmailDraft = {
	subject: "",
	headline: "",
	body: "",
	ctaLabel: "",
	ctaUrl: "",
	preheader: "",
	footnote: "",
};

interface Template {
	id: string;
	label: string;
	draft: EmailDraft;
}

const TEMPLATES: Template[] = [
	{
		id: "gift-500-unlocks",
		label: "Gift 500 unlocks",
		draft: {
			subject: "500 unlocks, on me",
			headline: "For the songs you kept.",
			body: `You're here early, before there's much to show for it, and that means more than you know. So I've put 500 unlocks on your account. Nothing to do, they're already there on the email you signed up with.

It's still rough around the edges, and far from perfect. If you ever want to tell me how it feels, that'd mean a lot. Reply here, or tap the bubble in the bottom-right corner of the app.`,
			ctaLabel: "Open hearted.",
			ctaUrl: "https://hearted.music",
			preheader: "I've put 500 unlocks on your account, on me.",
			footnote: "— ♡ hearted.music",
		},
	},
];

interface Recipient {
	accountId: string;
	email: string;
	label: string;
}

interface SendResult {
	to: string;
	subject: string;
	id: string | null;
	runId: string | null;
}

function currentDraftFingerprint(draft: EmailDraft, templateId: string | null) {
	return JSON.stringify({ draft, templateId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreviewResponse(
	value: unknown,
): value is { html: string; text: string } {
	return (
		isRecord(value) &&
		typeof value.html === "string" &&
		typeof value.text === "string"
	);
}

function previewErrorMessage(value: unknown, status: number): string {
	if (isRecord(value) && typeof value.error === "string") {
		return value.error;
	}
	return `Preview request failed (${status}).`;
}

function knownTemplateId(templateId: string | null | undefined): string | null {
	return TEMPLATES.some((template) => template.id === templateId)
		? (templateId ?? null)
		: null;
}

function readInitialState() {
	const stored = readEmailDraft();
	const params = new URL(window.location.href).searchParams;
	const duplicateRun = params.get("duplicateRun");
	const duplicate = duplicateRun ? readEmailHistoryDraft(duplicateRun) : null;
	if (duplicateRun) {
		const next = new URL(window.location.href);
		next.searchParams.delete("duplicateRun");
		window.history.replaceState({ controlPanel: true }, "", next);
	}
	const to = params.get("to") ?? "";
	const toLabel = params.get("toLabel") ?? "";
	if (to) {
		const next = new URL(window.location.href);
		next.searchParams.delete("to");
		next.searchParams.delete("toLabel");
		window.history.replaceState({ controlPanel: true }, "", next);
	}
	return {
		draft: duplicate?.draft ?? stored?.draft ?? EMPTY,
		templateId: knownTemplateId(duplicate?.templateId ?? stored?.templateId),
		to,
		toLabel,
		duplicateUnavailable: duplicateRun !== null && duplicate === null,
	};
}

export function EmailSection() {
	const [initial] = useState(readInitialState);
	const [draft, setDraft] = useState<EmailDraft>(initial.draft);
	const [templateId, setTemplateId] = useState<string | null>(
		initial.templateId,
	);
	const [to, setTo] = useState(initial.to);
	const [toLabel, setToLabel] = useState(initial.toLabel);
	const [toAccountId, setToAccountId] = useState<string | null>(null);
	const [additionalRecipients, setAdditionalRecipients] = useState<Recipient[]>(
		[],
	);
	const [recipientPickerKey, setRecipientPickerKey] = useState(0);
	const [previewHtml, setPreviewHtml] = useState("");
	const [previewText, setPreviewText] = useState("");
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [previewStale, setPreviewStale] = useState(true);
	const [tab, setTab] = useState<"html" | "text">("html");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState<SendResult | null>(null);
	const [testAddress, setTestAddress] = useState("");
	const [testResult, setTestResult] = useState<EmailTestResult | null>(null);
	const [testFingerprint, setTestFingerprint] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);
	const [clearOpen, setClearOpen] = useState(false);
	const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
	const [batchOpen, setBatchOpen] = useState(false);

	const fingerprint = currentDraftFingerprint(draft, templateId);
	const hasCurrentTest = testResult !== null && testFingerprint === fingerprint;
	const recipientCount = (to ? 1 : 0) + additionalRecipients.length;
	const accountIds = [
		...(toAccountId ? [toAccountId] : []),
		...additionalRecipients.map((recipient) => recipient.accountId),
	];
	const canSend =
		EMAIL_RE.test(to) &&
		!!draft.subject.trim() &&
		!!draft.headline.trim() &&
		!!draft.body.trim() &&
		!!draft.ctaLabel.trim() &&
		!!draft.ctaUrl.trim();
	const canBatch =
		canSend && recipientCount > 1 && accountIds.length === recipientCount;

	useEffect(() => {
		writeEmailDraft({ draft, templateId });
	}, [draft, templateId]);

	useEffect(() => {
		const controller = new AbortController();
		setPreviewStale(true);
		const timer = window.setTimeout(() => {
			fetch("/api/email/preview", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(draft),
				signal: controller.signal,
			})
				.then(async (response) => {
					const result: unknown = await response.json();
					if (!response.ok) {
						throw new Error(previewErrorMessage(result, response.status));
					}
					if (!isPreviewResponse(result)) {
						throw new Error("Preview response was invalid.");
					}
					return result;
				})
				.then((result) => {
					setPreviewHtml(result.html);
					setPreviewText(result.text);
					setPreviewError(null);
					setPreviewStale(false);
				})
				.catch((reason: unknown) => {
					if (controller.signal.aborted) return;
					setPreviewError(
						reason instanceof Error ? reason.message : String(reason),
					);
					setPreviewStale(true);
				});
		}, 200);
		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	}, [draft]);

	function set<K extends keyof EmailDraft>(key: K, value: string) {
		setDraft((current) => ({ ...current, [key]: value }));
	}

	function applyTemplate(template: Template) {
		setDraft(template.draft);
		setTemplateId(template.id);
	}

	function clearDraft() {
		if (isDraftEmpty(draft)) {
			setDraft(EMPTY);
			setTemplateId(null);
			return;
		}
		setClearOpen(true);
	}

	async function sendTest() {
		if (!EMAIL_RE.test(testAddress) || !canSend) return;
		setTesting(true);
		setError(null);
		try {
			const result = await sendEmailTest({
				...draft,
				templateId,
				to: testAddress.trim(),
			});
			setTestResult(result);
			setTestFingerprint(fingerprint);
			toast.success(`Test sent to ${testAddress.trim()}`);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setTesting(false);
		}
	}

	async function send() {
		setSending(true);
		setError(null);
		setSent(null);
		try {
			const result = await postJson<SendResult>("/api/email/send", {
				...draft,
				templateId,
				to,
			});
			setSent(result);
			if (result.runId) {
				rememberEmailHistoryDraft(result.runId, { draft, templateId });
			}
			toast.success(`Email sent to ${result.to}`);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
			throw reason;
		} finally {
			setSending(false);
		}
	}

	function addRecipient(
		_value: string,
		_label: string,
		account?: AccountSearchResult,
	) {
		if (!account) return;
		const email = account.email;
		if (!email) return;
		if (additionalRecipients.length >= 49) {
			setError("Email batches are limited to 50 verified recipients.");
			return;
		}
		if (
			account.id === toAccountId ||
			additionalRecipients.some((r) => r.accountId === account.id)
		) {
			setError(`${account.label} is already a recipient.`);
			return;
		}
		setAdditionalRecipients((current) => [
			...current,
			{ accountId: account.id, email, label: account.label },
		]);
		setRecipientPickerKey((key) => key + 1);
	}

	return (
		<div className="email-layout">
			<Card title="Compose" icon={PaperPlaneTiltIcon} span={12}>
				<p className="muted-text" style={{ marginBottom: 16 }}>
					Sends a transactional email in Hearted&apos;s house style via Resend.
					The preview updates as you type.
				</p>
				{initial.duplicateUnavailable && (
					<div className="result warn">
						This email&apos;s body is not available in this browser. Action
						history stores only a body hash and length.
					</div>
				)}

				<div className="field">
					<label htmlFor="email-template">Start from a template</label>
					<div className="btn-row" id="email-template">
						{TEMPLATES.map((template) => (
							<button
								key={template.id}
								type="button"
								className={`btn ${templateId === template.id ? "active" : ""}`}
								onClick={() => applyTemplate(template)}
							>
								{template.label}
							</button>
						))}
						<button type="button" className="btn" onClick={clearDraft}>
							Clear
						</button>
					</div>
				</div>

				<div className="field">
					<label htmlFor="email-to">
						Recipient<span style={{ color: "var(--accent)" }}> *</span>
					</label>
					<AccountPicker
						inputId="email-to"
						placeholder="Search verified users, or type any email…"
						value={to}
						label={toLabel}
						allowRawEmail
						selectValue={(account) => account.email ?? ""}
						onChange={(value, label, account) => {
							setTo(value);
							setToLabel(label);
							setToAccountId(account?.id ?? null);
						}}
					/>
				</div>

				<div className="field">
					<label htmlFor="email-add-recipient">
						Add verified batch recipient
					</label>
					<AccountPicker
						key={recipientPickerKey}
						inputId="email-add-recipient"
						placeholder="Search verified Hearted users…"
						value=""
						label=""
						onChange={addRecipient}
					/>
					{additionalRecipients.length > 0 && (
						<ul
							className="email-recipient-list"
							aria-label="Additional recipients"
						>
							{additionalRecipients.map((recipient) => (
								<li key={recipient.accountId}>
									<span>
										{recipient.label} · {recipient.email}
									</span>
									<button
										type="button"
										className="icon-btn"
										aria-label={`Remove ${recipient.label}`}
										onClick={() =>
											setAdditionalRecipients((current) =>
												current.filter(
													(candidate) =>
														candidate.accountId !== recipient.accountId,
												),
											)
										}
									>
										<XIcon size={14} weight="bold" />
									</button>
								</li>
							))}
						</ul>
					)}
					<span className="field-hint">
						Multiple recipients use the verified-recipient batch flow (maximum
						50).
					</span>
				</div>

				<TextField
					id="email-subject"
					label="Subject"
					required
					placeholder="your liked songs have something to tell you"
					value={draft.subject}
					onChange={(value) => set("subject", value)}
				/>
				<TextField
					id="email-headline"
					label="Headline"
					required
					placeholder="One step left."
					value={draft.headline}
					onChange={(value) => set("headline", value)}
				/>

				<div className="field">
					<label htmlFor="email-body">
						Body<span style={{ color: "var(--accent)" }}> *</span>
						<span className="field-hint">
							{" "}
							— blank line starts a new paragraph
						</span>
					</label>
					<textarea
						id="email-body"
						className="input textarea"
						rows={7}
						placeholder="Write the message in plain prose…"
						value={draft.body}
						{...noAutofill}
						onChange={(event) => set("body", event.target.value)}
					/>
				</div>

				<div className="field-row">
					<TextField
						id="email-cta-label"
						label="Button label"
						required
						placeholder="Open hearted."
						value={draft.ctaLabel}
						onChange={(value) => set("ctaLabel", value)}
					/>
					<TextField
						id="email-cta-url"
						label="Button URL"
						required
						placeholder="https://hearted.music"
						value={draft.ctaUrl}
						onChange={(value) => set("ctaUrl", value)}
					/>
				</div>
				<TextField
					id="email-preheader"
					label="Inbox preview"
					placeholder="Defaults to the subject"
					value={draft.preheader}
					onChange={(value) => set("preheader", value)}
				/>
				<TextField
					id="email-footnote"
					label="Footnote"
					placeholder="— ♡ hearted.music"
					value={draft.footnote}
					onChange={(value) => set("footnote", value)}
				/>

				<div className="field email-test-send">
					<label htmlFor="email-test-address">Send a test to yourself</label>
					<div className="btn-row">
						<input
							id="email-test-address"
							className="input"
							type="email"
							placeholder="you@hearted.music"
							value={testAddress}
							onChange={(event) => setTestAddress(event.target.value)}
						/>
						<button
							type="button"
							className="btn"
							disabled={!canSend || !EMAIL_RE.test(testAddress) || testing}
							onClick={sendTest}
						>
							{testing ? "Sending test…" : "Send test"}
						</button>
					</div>
					{testResult && (
						<span className={hasCurrentTest ? "dim" : "result warn"}>
							{hasCurrentTest
								? "Test sent for this draft."
								: "Draft changed after this test; send another test before batching."}
						</span>
					)}
				</div>

				<div className="btn-row">
					{recipientCount <= 1 ? (
						<button
							type="button"
							className="btn primary"
							disabled={!canSend || sending}
							onClick={() => setSendConfirmOpen(true)}
						>
							<PaperPlaneTiltIcon size={14} weight="fill" />
							{sending ? "Sending…" : "Send email"}
						</button>
					) : (
						<button
							type="button"
							className="btn primary"
							disabled={!canBatch}
							onClick={() => setBatchOpen(true)}
						>
							<PaperPlaneTiltIcon size={14} weight="fill" />
							Preview email batch ({recipientCount})
						</button>
					)}
				</div>
				{recipientCount > 1 && !canBatch && (
					<div className="result warn">
						Every batch recipient must be a verified Hearted account.
					</div>
				)}
				{error && <div className="result err">{error}</div>}
				{sent && (
					<div className="result ok">
						<strong>Sent</strong> — delivered “{sent.subject}” to {sent.to}.
						{sent.id && <pre>Resend id: {sent.id}</pre>}
					</div>
				)}
			</Card>

			<div className="email-preview">
				<div className="email-preview-head">
					<span className="email-preview-title">
						Preview{previewStale ? " · stale" : ""}
					</span>
					<div className="seg">
						<button
							type="button"
							className={`seg-btn ${tab === "html" ? "active" : ""}`}
							onClick={() => setTab("html")}
						>
							HTML
						</button>
						<button
							type="button"
							className={`seg-btn ${tab === "text" ? "active" : ""}`}
							onClick={() => setTab("text")}
						>
							Plain text
						</button>
					</div>
				</div>
				{previewError && (
					<div className="result err">
						Preview could not update: {previewError}. Showing the last
						successful preview.
					</div>
				)}
				{tab === "html" ? (
					<iframe
						title="Email preview"
						className="email-preview-frame"
						sandbox=""
						srcDoc={previewHtml}
					/>
				) : (
					<pre className="email-preview-text">{previewText}</pre>
				)}
			</div>

			{clearOpen && (
				<ConfirmModal
					title="Clear email draft"
					description="Clear every draft field? This does not change the selected recipients."
					confirmLabel="Clear draft"
					onConfirm={async () => {
						setDraft(EMPTY);
						setTemplateId(null);
						setClearOpen(false);
					}}
					onClose={() => setClearOpen(false)}
				/>
			)}
			{sendConfirmOpen && (
				<ConfirmModal
					title="Send email to production recipient"
					description={
						<>
							Send <strong>{draft.subject}</strong> to{" "}
							<strong>{toLabel || to}</strong> via Resend? This email cannot be
							unsent.
						</>
					}
					confirmLabel="Send email"
					onConfirm={async () => {
						await send();
						setSendConfirmOpen(false);
					}}
					onClose={() => setSendConfirmOpen(false)}
				/>
			)}
			{batchOpen && (
				<BatchLauncher
					actionType="email-batch"
					title="Send email — batch"
					description="Sends one email per verified recipient through Resend. This writes to production and cannot be undone."
					buildInput={() => ({ ...draft, templateId, accountIds })}
					emailGate={{
						getDraft: () => ({ ...draft, templateId }),
						testedBodyHash: hasCurrentTest
							? (testResult?.bodyHash ?? null)
							: null,
					}}
					onClose={() => setBatchOpen(false)}
				/>
			)}
		</div>
	);
}

function TextField({
	id,
	label,
	value,
	onChange,
	placeholder,
	required,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	required?: boolean;
}) {
	return (
		<div className="field">
			<label htmlFor={id}>
				{label}
				{required && <span style={{ color: "var(--accent)" }}> *</span>}
			</label>
			<input
				id={id}
				className="input"
				placeholder={placeholder}
				value={value}
				{...noAutofill}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}
