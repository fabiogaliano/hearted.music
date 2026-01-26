import { Playlist } from '@/lib/data/mock-data'
import { ThemeConfig } from '@/lib/theme/types'
import { fonts } from '@/lib/theme/fonts'

const COLLAPSED_ALBUM_SIZE_PX = '400px'
const EXPANDED_ALBUM_SIZE_PX = '240px'

interface MatchesSectionProps {
	playlists: Playlist[]
	theme: ThemeConfig
	addedTo: number[]
	onAdd: (playlistId: number) => void
	onSkip: () => void
	onNext: () => void
	isExpanded: boolean
}

export function MatchesSection({
	playlists,
	theme,
	addedTo,
	onAdd,
	onSkip,
	onNext,
	isExpanded,
}: MatchesSectionProps) {
	return (
		<div
			className="flex flex-col transition-[height,opacity] duration-500 ease-in-out"
			style={{
				opacity: isExpanded ? 0.6 : 1,
				height: isExpanded ? EXPANDED_ALBUM_SIZE_PX : COLLAPSED_ALBUM_SIZE_PX,
			}}
		>
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Best Matches
			</p>

			<div
				className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-2 transition-[margin-top,gap] duration-500 ease-in-out"
				style={{
					marginTop: isExpanded ? '1rem' : '1.5rem',
					gap: isExpanded ? '0.75rem' : '1.25rem',
				}}
			>
				{playlists.map(playlist => {
					const isAdded = addedTo.includes(playlist.id)
					const isGoodMatch = playlist.matchScore >= 0.7

					return (
						<div
							key={playlist.id}
							className="group transition-[padding-bottom] duration-500 ease-in-out"
							style={{
								borderBottom: `1px solid ${theme.border}`,
								paddingBottom: isExpanded ? '0.75rem' : '1.25rem',
							}}
						>
							<div className="flex items-start justify-between">
								<div className="flex items-start gap-3">
									<span
										className="font-extralight tabular-nums transition-[font-size] duration-500 ease-in-out"
										style={{
											fontFamily: fonts.display,
											color: isGoodMatch ? theme.text : theme.textMuted,
											fontSize: isExpanded ? '1.5rem' : '2rem',
										}}
									>
										{Math.round(playlist.matchScore * 100)}%
									</span>
									<div className="pt-1">
										<h3
											className="font-light transition-[font-size] duration-500 ease-in-out"
											style={{
												fontFamily: fonts.display,
												color: theme.text,
												fontSize: isExpanded ? '1rem' : '1.125rem',
											}}
										>
											{playlist.name}
										</h3>
										{playlist.description && (
											<p
												className="mt-0.5 text-xs"
												style={{ fontFamily: fonts.body, color: theme.textMuted }}
											>
												{playlist.description}
											</p>
										)}
									</div>
								</div>

								{isAdded ?
									<span
										className="text-sm tracking-widest uppercase opacity-50"
										style={{ fontFamily: fonts.body, color: theme.textMuted }}
									>
										Added
									</span>
								:	<button
										onClick={() => onAdd(playlist.id)}
										className="text-sm tracking-widest uppercase opacity-0 transition-opacity group-hover:opacity-100"
										style={{ fontFamily: fonts.body, color: theme.text }}
									>
										Add
									</button>
								}
							</div>
						</div>
					)
				})}
			</div>

			{/* Navigation */}
			<div
				className="flex items-center justify-between transition-[margin-top,padding-top] duration-500 ease-in-out"
				style={{
					marginTop: isExpanded ? 'auto' : '2rem',
					paddingTop: isExpanded ? '0.75rem' : '0rem',
				}}
			>
				<button
					onClick={onSkip}
					className="text-sm tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Skip
				</button>

				<button
					onClick={onNext}
					className="group inline-flex items-center gap-3"
					style={{ fontFamily: fonts.body, color: theme.text }}
				>
					<span
						className={
							isExpanded ?
								'text-base font-medium tracking-wide'
							:	'text-lg font-medium tracking-wide'
						}
					>
						Next Song
					</span>
					<span
						className="inline-block transition-transform group-hover:translate-x-1"
						style={{ color: theme.textMuted }}
					>
						&rarr;
					</span>
				</button>
			</div>
		</div>
	)
}
