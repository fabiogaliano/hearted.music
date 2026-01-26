interface FlagIconProps {
	filled: boolean
	color: string
	size?: number
}

export function FlagIcon({ filled, color, size = 20 }: FlagIconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill={filled ? color : 'none'}
			stroke={color}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
			<line x1="4" y1="22" x2="4" y2="15" />
		</svg>
	)
}
