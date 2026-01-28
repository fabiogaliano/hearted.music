import { type FC } from 'react'

export const GrainOverlay: FC = () => {
	return (
		<div
			className="pointer-events-none fixed inset-0 z-9999 opacity-[0.035]"
			style={{
				background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
			}}
		>
			<style>{`
        @keyframes noise-anim {
          0% { transform: translate(0,0) }
          10% { transform: translate(-5%,-5%) }
          20% { transform: translate(-10%,5%) }
          30% { transform: translate(5%,-10%) }
          40% { transform: translate(-5%,15%) }
          50% { transform: translate(-10%,5%) }
          60% { transform: translate(15%,0) }
          70% { transform: translate(0,10%) }
          80% { transform: translate(-15%,0) }
          90% { transform: translate(10%,5%) }
          100% { transform: translate(5%,0) }
        }
        .animate-grain {
          animation: noise-anim 0.2s infinite;
        }
      `}</style>
			<div
				className="animate-grain absolute inset-[-200%] h-[500%] w-[500%] bg-repeat"
				style={{ backgroundImage: 'inherit' }}
			/>
		</div>
	)
}

export default GrainOverlay
