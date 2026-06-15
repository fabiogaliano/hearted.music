import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { AccountPicker } from "../components/AccountPicker";
import { Card } from "../components/primitives";
import { postJson } from "../lib/api";
import { noAutofill } from "../lib/form";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Draft {
	subject: string;
	headline: string;
	body: string;
	ctaLabel: string;
	ctaUrl: string;
	preheader: string;
	footnote: string;
}

const EMPTY: Draft = {
	subject: "",
	headline: "",
	body: "",
	ctaLabel: "",
	ctaUrl: "",
	preheader: "",
	footnote: "",
};

interface SendResult {
	to: string;
	subject: string;
	id: string | null;
}

export function EmailSection() {
	const [draft, setDraft] = useState<Draft>(EMPTY);
	const [to, setTo] = useState("");
	const [toLabel, setToLabel] = useState("");
	const [previewHtml, setPreviewHtml] = useState("");
	const [tab, setTab] = useState<"html" | "text">("html");
	const [previewText, setPreviewText] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState<SendResult | null>(null);

	function set<K extends keyof Draft>(key: K, value: string) {
		setDraft((d) => ({ ...d, [key]: value }));
	}

	// Debounced live render: the server renders the same envelope it would send
	// (leniently, so half-typed drafts still preview). AbortController drops
	// in-flight renders so the iframe always reflects the latest keystroke.
	useEffect(() => {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			fetch("/api/email/preview", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(draft),
				signal: controller.signal,
			})
				.then((r) => r.json())
				.then((res: { html?: string; text?: string }) => {
					setPreviewHtml(res.html ?? "");
					setPreviewText(res.text ?? "");
				})
				.catch(() => {});
		}, 200);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [draft]);

	const canSend =
		EMAIL_RE.test(to) &&
		!!draft.subject.trim() &&
		!!draft.headline.trim() &&
		!!draft.body.trim() &&
		!!draft.ctaLabel.trim() &&
		!!draft.ctaUrl.trim();

	async function send() {
		const who = toLabel || to;
		if (
			!window.confirm(
				`Send "${draft.subject}" to ${who} via Resend?\n\nThis is a real email and cannot be unsent.`,
			)
		)
			return;
		setSending(true);
		setError(null);
		setSent(null);
		try {
			const res = await postJson<SendResult>("/api/email/send", {
				...draft,
				to,
			});
			setSent(res);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSending(false);
		}
	}

	return (
		<div className="email-layout">
			<Card title="Compose" icon={PaperPlaneTiltIcon} span={12}>
				<p className="muted-text" style={{ marginBottom: 16 }}>
					Sends a transactional email in Hearted's house style (the same
					envelope as the verify/reset flows) via Resend. The preview updates as
					you type.
				</p>

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
						selectValue={(r) => r.email ?? ""}
						onChange={(value, label) => {
							if (!value) {
								setTo("");
								setToLabel("");
								return;
							}
							setTo(value);
							setToLabel(label);
						}}
					/>
				</div>

				<TextField
					id="email-subject"
					label="Subject"
					required
					placeholder="your liked songs have something to tell you"
					value={draft.subject}
					onChange={(v) => set("subject", v)}
				/>
				<TextField
					id="email-headline"
					label="Headline"
					required
					placeholder="One step left."
					value={draft.headline}
					onChange={(v) => set("headline", v)}
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
						onChange={(e) => set("body", e.target.value)}
					/>
				</div>

				<div className="field-row">
					<TextField
						id="email-cta-label"
						label="Button label"
						required
						placeholder="Open hearted."
						value={draft.ctaLabel}
						onChange={(v) => set("ctaLabel", v)}
					/>
					<TextField
						id="email-cta-url"
						label="Button URL"
						required
						placeholder="https://hearted.music"
						value={draft.ctaUrl}
						onChange={(v) => set("ctaUrl", v)}
					/>
				</div>

				<TextField
					id="email-preheader"
					label="Inbox preview"
					placeholder="Defaults to the subject"
					value={draft.preheader}
					onChange={(v) => set("preheader", v)}
				/>
				<TextField
					id="email-footnote"
					label="Footnote"
					placeholder="— ♡ hearted.music"
					value={draft.footnote}
					onChange={(v) => set("footnote", v)}
				/>

				<div className="btn-row">
					<button
						type="button"
						className="btn primary"
						disabled={!canSend || sending}
						onClick={send}
					>
						<PaperPlaneTiltIcon size={14} weight="fill" />
						{sending ? "Sending…" : "Send email"}
					</button>
				</div>

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
					<span className="email-preview-title">Preview</span>
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
				onChange={(e) => onChange(e.target.value)}
			/>
		</div>
	);
}
