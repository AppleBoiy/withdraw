/**
 * An ensō painted in one brush stroke, as an SVG outline in a 100 × 100 box.
 * The centre line runs clockwise from the top; the width follows a brush: a wet, heavy start,
 * a swell and ease through the middle, and a dry tail that runs out before it meets the start.
 * Pure maths (no DOM), so the same shape is used by the welcome mark and the favicon script.
 */
export interface Brush {
  /** filled outline of the stroke */
  outline: string
  /** the centre line, for revealing the stroke as if painted */
  centre: string
  /** thin lines where the bristles part near the tail */
  dry: string
}

export function ensoBrush(opts: { r?: number; weight?: number; sweep?: number } = {}): Brush {
  const R = opts.r ?? 36, W = opts.weight ?? 10, sweep = opts.sweep ?? 330
  const N = 180, a0 = -100 // degrees; 0 is to the right, so this starts just left of the top
  const left: string[] = [], right: string[] = [], centre: string[] = []
  const hairs: [number, number][] = [[-0.55, 0.52], [-0.12, 0.64], [0.32, 0.47], [0.64, 0.72]]
  const lines: string[][] = hairs.map(() => [])
  const f = (n: number) => n.toFixed(2)
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const a = ((a0 + t * sweep) * Math.PI) / 180
    // a hand-drawn circle is never quite round: a slow wobble in the radius
    const r = R + Math.sin(t * 5.1 + 0.6) * 1.2 + Math.sin(t * 11.7) * 0.4
    const x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r
    const nx = Math.cos(a), ny = Math.sin(a)
    let w = t < 0.07 ? W * (0.4 + (t / 0.07) * 0.6) : W * (1 - Math.sin(t * 9) * 0.1 - t * 0.22)
    if (t > 0.66) w *= Math.pow(Math.max(0, 1 - (t - 0.66) / 0.3), 1.15)
    w = Math.max(0.3, w) / 2
    // the brush leans: more ink on the outside of the curve
    const out = w * 1.08, inn = w * 0.92
    left.push(`${f(x + nx * out)} ${f(y + ny * out)}`)
    right.unshift(`${f(x - nx * inn)} ${f(y - ny * inn)}`)
    centre.push(`${f(x)} ${f(y)}`)
    hairs.forEach(([k, from], j) => {
      if (t >= from && t < 0.9) lines[j].push(`${f(x + nx * w * k)} ${f(y + ny * w * k)}`)
    })
  }
  return {
    outline: `M${left.join('L')}L${right.join('L')}Z`,
    centre: `M${centre.join('L')}`,
    dry: lines.filter((l) => l.length > 1).map((l) => `M${l.join('L')}`).join(''),
  }
}
