import { useCallback, useRef, useState } from 'react'

import { type ThemeConfig } from '@/lib/theme/types'
import { fonts } from '@/lib/theme/fonts'

export interface ThemesListProps {
	themes: Array<{ name: string; confidence: number }>
	theme: ThemeConfig
}

const THEME_DESCRIPTIONS: Record<string, string> = {
	'Lost Love':
		"The ache of what was and what could have been — a wound that time hasn't fully healed.",
	'Personal Flaws':
		"Confronting the parts of yourself that got in the way, the patterns you couldn't break.",
	'Complexity of Connection':
		"Love isn't simple — it's messy, contradictory, and somehow worth it anyway.",
	Codependency: 'When your sense of self becomes tangled with another person.',
	'Emotional Distance': "The space between what's felt and what's said.",
	'Wealth and Success': 'The pursuit that drives and sometimes consumes.',
	'Street Hustle': 'Survival instincts sharpened by necessity.',
	'Power and Influence': 'The weight of impact and the responsibility it carries.',
	'Youthful Ambition': 'That early fire before life teaches you to temper it.',
	'Self-Identity': 'The ongoing project of figuring out who you are.',
	'Self-Reflection': 'Looking inward, sometimes uncomfortably.',
	'Fear and Vulnerability': 'The courage it takes to be seen.',
}

function getThemeDescription(name: string): string {
	return THEME_DESCRIPTIONS[name] || 'A recurring thread that runs through your music.'
}

export function ThemesList({ themes, theme: themeConfig }: ThemesListProps) {
	const [openIndex, setOpenIndex] = useState<number>(-1)
	const [pinnedIndex, setPinnedIndex] = useState<number>(-1)
	const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const handleHover = useCallback(
		(index: number) => {
			if (closeTimeoutRef.current) {
				clearTimeout(closeTimeoutRef.current)
				closeTimeoutRef.current = null
			}
			if (pinnedIndex === -1) {
				setOpenIndex(index)
			}
		},
		[pinnedIndex]
	)

	const handleClick = useCallback(
		(index: number) => {
			if (pinnedIndex === index) {
				setPinnedIndex(-1)
				setOpenIndex(-1)
			} else {
				setPinnedIndex(index)
				setOpenIndex(index)
			}
		},
		[pinnedIndex]
	)

	const handleListLeave = useCallback(() => {
		if (pinnedIndex === -1) {
			closeTimeoutRef.current = setTimeout(() => {
				setOpenIndex(-1)
			}, 150)
		}
	}, [pinnedIndex])

	return (
		<div onMouseLeave={handleListLeave}>
			<h4
				className="mb-4 text-[10px] tracking-[0.2em] uppercase"
				style={{ fontFamily: fonts.body, color: themeConfig.textMuted }}
			>
				What It's About
			</h4>
			<div className="space-y-3">
				{themes.map((themeItem, index) => (
					<div
						key={index}
						className="group cursor-pointer"
						onMouseEnter={() => handleHover(index)}
						onClick={() => handleClick(index)}
					>
						<p className="text-sm font-medium" style={{ color: themeConfig.text }}>
							{themeItem.name}
							{getThemeDescription(themeItem.name) && (
								<span
									className="ml-2 text-xs transition-opacity"
									style={{
										color: themeConfig.textMuted,
										opacity: openIndex === index ? 0 : 0.5,
									}}
								>
									↓
								</span>
							)}
						</p>
						<div
							className="overflow-hidden transition-all duration-200"
							style={{
								maxHeight: openIndex === index ? '100px' : '0px',
								opacity: openIndex === index ? 1 : 0,
								marginTop: openIndex === index ? '6px' : '0px',
							}}
						>
							<p
								className="text-xs leading-relaxed"
								style={{ color: themeConfig.textMuted }}
							>
								{getThemeDescription(themeItem.name)}
							</p>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
