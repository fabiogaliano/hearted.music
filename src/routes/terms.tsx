import { createFileRoute } from "@tanstack/react-router";
import { ContentBlocks } from "@/features/legal/components";
import { LegalPageShell } from "@/features/legal/LegalPageShell";
import { termsData } from "@/lib/data/legal";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/terms")({
	component: TermsPage,
});

function TermsPage() {
	return (
		<LegalPageShell activePage="terms">
			<div className="theme-border-color border-b px-8 pt-16 pb-12 md:px-16">
				<h1
					style={{ fontFamily: fonts.display }}
					className="theme-text text-[56px] leading-none font-extralight tracking-tight italic md:text-[80px]"
				>
					terms of service
				</h1>
				<p className="theme-text-muted mt-4 text-sm tracking-widest uppercase">
					Last updated {termsData.lastUpdated}
				</p>
			</div>

			<div className="flex flex-col md:flex-row md:items-start">
				<aside className="theme-border-color sticky top-0 hidden w-52 shrink-0 self-start border-r md:block">
					<div className="space-y-1 px-8 pt-10 pb-8">
						<p className="theme-text-muted mb-4 text-xs tracking-widest uppercase">
							sections
						</p>
						{termsData.sections.map((section) => (
							<a
								key={section.number}
								href={`#section-${section.number}`}
								className="theme-text-muted block py-1.5 text-sm opacity-60 transition-opacity duration-200 hover:opacity-100"
							>
								{section.title}
							</a>
						))}
					</div>
				</aside>

				<div className="max-w-3xl flex-1 space-y-12 px-8 pt-10 pb-32 md:px-12">
					<div className="theme-surface-bg theme-border-color rounded-[8px] border p-6">
						<p className="theme-text-muted mb-3 text-xs font-medium tracking-widest uppercase">
							The short version
						</p>
						<p className="theme-text text-base leading-relaxed whitespace-pre-line">
							{termsData.summary}
						</p>
					</div>

					{termsData.sections.map((section) => (
						<section key={section.number} id={`section-${section.number}`}>
							<div className="mb-6 flex items-baseline gap-4">
								<span className="theme-text-muted shrink-0 text-xs tracking-widest uppercase">
									{String(section.number).padStart(2, "0")}
								</span>
								<h2
									style={{ fontFamily: fonts.display }}
									className="theme-text text-[28px] leading-tight font-light italic"
								>
									{section.title}
								</h2>
							</div>
							<ContentBlocks blocks={section.content} />
						</section>
					))}
				</div>
			</div>
		</LegalPageShell>
	);
}
