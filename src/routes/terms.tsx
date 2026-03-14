import { createFileRoute } from "@tanstack/react-router";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { fonts } from "@/lib/theme/fonts";
import { LegalPageShell } from "@/features/legal/LegalPageShell";
import { ContentBlocks } from "@/features/legal/components";
import { termsData } from "@/lib/data/legal";

export const Route = createFileRoute("/terms")({
	component: TermsPage,
});

function TermsPage() {
	const theme = useTheme();

	return (
		<LegalPageShell activePage="terms">
			<div
				style={{ borderBottom: `1px solid ${theme.border}` }}
				className="pt-16 pb-12 px-8 md:px-16"
			>
				<h1
					style={{ fontFamily: fonts.display, color: theme.text }}
					className="italic text-[56px] md:text-[80px] font-extralight tracking-tight leading-none"
				>
					terms of service
				</h1>
				<p
					style={{ color: theme.textMuted }}
					className="text-sm mt-4 uppercase tracking-widest"
				>
					Last updated {termsData.lastUpdated}
				</p>
			</div>

			<div className="flex flex-col md:flex-row md:items-start">
				<aside
					style={{ borderRight: `1px solid ${theme.border}` }}
					className="hidden md:block w-52 shrink-0 sticky top-0 self-start"
				>
					<div className="pt-10 pb-8 px-8 space-y-1">
						<p
							style={{ color: theme.textMuted }}
							className="text-[10px] uppercase tracking-widest mb-4"
						>
							sections
						</p>
						{termsData.sections.map((section) => (
							<a
								key={section.number}
								href={`#section-${section.number}`}
								style={{ color: theme.textMuted }}
								className="block text-sm py-1.5 opacity-60 hover:opacity-100 transition-opacity duration-200"
							>
								{section.title}
							</a>
						))}
					</div>
				</aside>

				<div className="flex-1 px-8 md:px-12 pt-10 pb-32 space-y-12 max-w-3xl">
					<div
						style={{
							border: `1px solid ${theme.border}`,
							backgroundColor: theme.surface,
						}}
						className="rounded-[8px] p-6"
					>
						<p
							style={{ color: theme.textMuted }}
							className="text-xs uppercase tracking-widest font-medium mb-3"
						>
							The short version
						</p>
						<p
							style={{ color: theme.text }}
							className="text-base leading-relaxed whitespace-pre-line"
						>
							{termsData.summary}
						</p>
					</div>

					{termsData.sections.map((section) => (
						<section key={section.number} id={`section-${section.number}`}>
							<div className="flex items-baseline gap-4 mb-6">
								<span
									style={{ color: theme.textMuted }}
									className="text-xs uppercase tracking-widest shrink-0"
								>
									{String(section.number).padStart(2, "0")}
								</span>
								<h2
									style={{ fontFamily: fonts.display, color: theme.text }}
									className="italic text-[28px] font-light leading-tight"
								>
									{section.title}
								</h2>
							</div>
							<ContentBlocks blocks={section.content} theme={theme} />
						</section>
					))}
				</div>
			</div>
		</LegalPageShell>
	);
}
