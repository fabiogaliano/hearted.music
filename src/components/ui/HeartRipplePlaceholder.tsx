import { useMemo } from 'react'

import { type ThemeConfig } from '@/lib/theme/types'
import { getThemeHue } from '@/lib/theme/colors'
import { generatePalette, vec3ToRgbString } from '@/lib/utils/palette'

interface HeartRipplePlaceholderProps {
	theme?: ThemeConfig
	className?: string
	style?: React.CSSProperties
}

export function HeartRipplePlaceholder({
	theme,
	className,
	style,
}: HeartRipplePlaceholderProps) {
	const hue = theme ? getThemeHue(theme) : 218
	const palette = useMemo(() => generatePalette(hue), [hue])

	const bg = vec3ToRgbString(palette.background)
	const bgTransparent = `rgba(${Math.round(palette.background[0] * 255)}, ${Math.round(palette.background[1] * 255)}, ${Math.round(palette.background[2] * 255)}, 0)`
	const primary = vec3ToRgbString(palette.primary)
	const secondary = vec3ToRgbString(palette.secondary)

	return (
		<div
			className={className}
			style={{
				width: '100%',
				height: '100%',
				background: bg,
				position: 'relative',
				overflow: 'hidden',
				...style,
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background: `
            radial-gradient(circle at 30% 40%, ${primary} 0%, transparent 60%),
            radial-gradient(circle at 70% 60%, ${secondary} 0%, transparent 60%)
          `,
					opacity: 0.6,
					filter: 'blur(60px)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background: `linear-gradient(135deg, ${bgTransparent} 0%, ${bg} 100%)`,
					opacity: 0.4,
				}}
			/>
		</div>
	)
}
