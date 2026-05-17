import { createFileRoute } from "@tanstack/react-router";
import { LegalPageShell } from "@/features/legal/LegalPageShell";
import { faqData } from "@/lib/content/legal";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/faq")({
	component: FaqPage,
});

function FaqPage() {
	return (
		<LegalPageShell activePage="faq">
			<div className="theme-border-color border-b px-8 pt-16 pb-12 md:px-16">
				<h1
					style={{ fontFamily: fonts.display }}
					className="theme-text text-[56px] leading-none font-extralight tracking-tight italic md:text-[80px]"
				>
					questions &amp;
					<br />
					answers
				</h1>
			</div>

			<div className="flex flex-col md:flex-row md:items-start">
				<aside className="theme-border-color sticky top-0 hidden w-52 shrink-0 self-start border-r md:block">
					<div className="space-y-1 px-8 pt-10 pb-8">
						<p className="theme-text-muted mb-4 text-xs tracking-widest uppercase">
							sections
						</p>
						{faqData.sections.map((section, i) => (
							<a
								key={section.title}
								href={`#section-${i}`}
								className="theme-text-muted block py-1.5 text-sm opacity-60 transition-opacity duration-200 hover:opacity-100"
							>
								{section.title}
							</a>
						))}
					</div>
				</aside>

				<div className="max-w-3xl flex-1 space-y-20 px-8 pt-10 pb-32 md:px-12">
					{faqData.sections.map((section, i) => (
						<div key={section.title} id={`section-${i}`}>
							<div className="mb-8 flex items-baseline gap-4">
								<span className="theme-text-muted shrink-0 text-xs tracking-widest uppercase">
									{String(i + 1).padStart(2, "0")}
								</span>
								<h2
									style={{ fontFamily: fonts.display }}
									className="theme-text text-[32px] leading-tight font-light italic"
								>
									{section.title}
								</h2>
							</div>
							<div className="theme-border-color border-t">
								{section.items.map((item) => (
									<details
										key={item.q}
										className="theme-border-color group border-b"
									>
										<summary className="theme-text flex cursor-pointer list-none items-start justify-between gap-6 py-4 text-sm font-medium select-none transition-opacity duration-200 hover:opacity-70">
											<span>{item.q}</span>
											<span className="theme-text-muted mt-0.5 shrink-0 text-lg font-light">
												<span className="group-open:hidden">+</span>
												<span className="hidden group-open:inline">−</span>
											</span>
										</summary>
										<div className="theme-text-muted pb-5 text-sm leading-relaxed">
											{item.a}
										</div>
									</details>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</LegalPageShell>
	);
}
