// Palette utils - ThemeConfig not needed here

export type Vec3 = [number, number, number]

export interface ColorPalette {
	primary: Vec3
	secondary: Vec3
	background: Vec3
}

export function generatePalette(hue: number): ColorPalette {
	const hslToRgb = (h: number, s: number, l: number): Vec3 => {
		const hNorm = h / 360
		const c = (1 - Math.abs(2 * l - 1)) * s
		const x = c * (1 - Math.abs(((hNorm * 6) % 2) - 1))
		const m = l - c / 2

		let r = 0,
			g = 0,
			b = 0
		if (hNorm < 1 / 6) {
			r = c
			g = x
		} else if (hNorm < 2 / 6) {
			r = x
			g = c
		} else if (hNorm < 3 / 6) {
			g = c
			b = x
		} else if (hNorm < 4 / 6) {
			g = x
			b = c
		} else if (hNorm < 5 / 6) {
			r = x
			b = c
		} else {
			r = c
			b = x
		}

		return [r + m, g + m, b + m]
	}

	return {
		primary: hslToRgb(hue, 0.3, 0.5),
		secondary: hslToRgb((hue + 25) % 360, 0.25, 0.55),
		background: hslToRgb(hue, 0.22, 0.14),
	}
}

export function vec3ToRgbString(v: Vec3): string {
	return `rgb(${Math.round(v[0] * 255)}, ${Math.round(v[1] * 255)}, ${Math.round(v[2] * 255)})`
}
