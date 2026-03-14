import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { ContentBlock } from "@/lib/data/legal";

export const SUPPORT_EMAIL = "support@hearted.music";

export function EmailLink({ theme }: { theme: ThemeConfig }) {
	return (
		<a
			href={`mailto:${SUPPORT_EMAIL}`}
			style={{ color: theme.text }}
			className="underline underline-offset-4 hover:opacity-70 transition-opacity duration-200"
		>
			{SUPPORT_EMAIL}
		</a>
	);
}

export function SectionHeader({
	number,
	title,
	theme,
}: {
	number: number;
	title: string;
	theme: ThemeConfig;
}) {
	return (
		<div className="mb-4">
			<p
				style={{ color: theme.textMuted }}
				className="text-xs uppercase tracking-widest mb-1"
			>
				{number.toString().padStart(2, "0")}
			</p>
			<h2
				style={{ fontFamily: fonts.display, color: theme.text }}
				className="italic text-[24px] font-light"
			>
				{title}
			</h2>
		</div>
	);
}

function renderTextWithEmail(text: string, theme: ThemeConfig) {
	if (!text.includes("__EMAIL__")) {
		return <>{text}</>;
	}
	const parts = text.split("__EMAIL__");
	return (
		<>
			{parts[0]}
			<EmailLink theme={theme} />
			{parts[1]}
		</>
	);
}

export function ContentBlocks({
	blocks,
	theme,
}: {
	blocks: ContentBlock[];
	theme: ThemeConfig;
}) {
	return (
		<div
			style={{ color: theme.textMuted }}
			className="text-base leading-relaxed space-y-3"
		>
			{blocks.map((block, i) => {
				if (block.type === "paragraph") {
					return <p key={i}>{renderTextWithEmail(block.text, theme)}</p>;
				}
				if (block.type === "sub-heading") {
					return (
						<p
							key={i}
							style={{ color: theme.text }}
							className="font-medium mt-4 first:mt-0"
						>
							{block.text}
						</p>
					);
				}
				if (block.type === "list") {
					return (
						<ul key={i} className="space-y-1 list-disc list-inside">
							{block.items.map((item, j) => (
								<li key={j}>{item}</li>
							))}
						</ul>
					);
				}
				if (block.type === "definition-list") {
					return (
						<dl key={i} className="space-y-2">
							{block.items.map((item, j) => (
								<div key={j}>
									<dt
										style={{ color: theme.text }}
										className="font-medium inline"
									>
										{item.term}
									</dt>
									<dd className="inline">: {item.description}</dd>
								</div>
							))}
						</dl>
					);
				}
				return null;
			})}
		</div>
	);
}
