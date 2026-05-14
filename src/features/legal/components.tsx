import type { ContentBlock } from "@/lib/data/legal";
import { fonts } from "@/lib/theme/fonts";

export const SUPPORT_EMAIL = "support@hearted.music";

export function EmailLink() {
	return (
		<a
			href={`mailto:${SUPPORT_EMAIL}`}
			className="theme-text underline underline-offset-4 transition-opacity duration-200 hover:opacity-70"
		>
			{SUPPORT_EMAIL}
		</a>
	);
}

export function SectionHeader({
	number,
	title,
}: {
	number: number;
	title: string;
}) {
	return (
		<div className="mb-4">
			<p className="theme-text-muted mb-1 text-xs tracking-widest uppercase">
				{number.toString().padStart(2, "0")}
			</p>
			<h2
				style={{ fontFamily: fonts.display }}
				className="theme-text text-[24px] font-light italic"
			>
				{title}
			</h2>
		</div>
	);
}

function renderTextWithEmail(text: string) {
	if (!text.includes("__EMAIL__")) {
		return <>{text}</>;
	}
	const parts = text.split("__EMAIL__");
	return (
		<>
			{parts[0]}
			<EmailLink />
			{parts[1]}
		</>
	);
}

export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
	return (
		<div className="theme-text-muted space-y-3 text-base leading-relaxed">
			{blocks.map((block) => {
				if (block.type === "paragraph") {
					return (
						<p key={`paragraph-${block.text}`}>
							{renderTextWithEmail(block.text)}
						</p>
					);
				}
				if (block.type === "sub-heading") {
					return (
						<p
							key={`sub-heading-${block.text}`}
							className="theme-text mt-4 font-medium first:mt-0"
						>
							{block.text}
						</p>
					);
				}
				if (block.type === "list") {
					return (
						<ul
							key={`list-${block.items.join("|")}`}
							className="list-inside list-disc space-y-1"
						>
							{block.items.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					);
				}
				if (block.type === "definition-list") {
					return (
						<dl
							key={`definition-list-${block.items.map((item) => item.term).join("|")}`}
							className="space-y-2"
						>
							{block.items.map((item) => (
								<div key={item.term}>
									<dt className="theme-text inline font-medium">{item.term}</dt>
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
