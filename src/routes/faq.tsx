import { createFileRoute } from "@tanstack/react-router";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { fonts } from "@/lib/theme/fonts";
import { LegalPageShell } from "@/features/legal/LegalPageShell";
import { faqData } from "@/lib/data/legal";

export const Route = createFileRoute("/faq")({
	component: FaqPage,
});

function FaqPage() {
	const theme = useTheme();

	return (
		<LegalPageShell activePage="faq">
			<div
				style={{ borderBottom: `1px solid ${theme.border}` }}
				className="pt-16 pb-12 px-8 md:px-16"
			>
				<h1
					style={{ fontFamily: fonts.display, color: theme.text }}
					className="italic text-[56px] md:text-[80px] font-extralight tracking-tight leading-none"
				>
					questions &amp;
					<br />
					answers
				</h1>
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
						{faqData.sections.map((section, i) => (
							<a
								key={section.title}
								href={`#section-${i}`}
								style={{ color: theme.textMuted }}
								className="block text-sm py-1.5 opacity-60 hover:opacity-100 transition-opacity duration-200"
							>
								{section.title}
							</a>
						))}
					</div>
				</aside>

				<div className="flex-1 px-8 md:px-12 pt-10 pb-32 space-y-20 max-w-3xl">
					{faqData.sections.map((section, i) => (
						<div key={section.title} id={`section-${i}`}>
							<div className="flex items-baseline gap-4 mb-8">
								<span
									style={{ color: theme.textMuted }}
									className="text-xs uppercase tracking-widest shrink-0"
								>
									{String(i + 1).padStart(2, "0")}
								</span>
								<h2
									style={{ fontFamily: fonts.display, color: theme.text }}
									className="italic text-[32px] font-light leading-tight"
								>
									{section.title}
								</h2>
							</div>
							<div style={{ borderTop: `1px solid ${theme.border}` }}>
								{section.items.map((item) => (
									<details
										key={item.q}
										style={{ borderBottom: `1px solid ${theme.border}` }}
										className="group"
									>
										<summary
											style={{ color: theme.text }}
											className="py-4 cursor-pointer list-none flex justify-between items-start gap-6 text-sm font-medium select-none hover:opacity-70 transition-opacity duration-200"
										>
											<span>{item.q}</span>
											<span
												style={{ color: theme.textMuted }}
												className="text-lg font-light shrink-0 mt-0.5"
											>
												<span className="group-open:hidden">+</span>
												<span className="hidden group-open:inline">−</span>
											</span>
										</summary>
										<div
											style={{ color: theme.textMuted }}
											className="pb-5 text-sm leading-relaxed"
										>
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
