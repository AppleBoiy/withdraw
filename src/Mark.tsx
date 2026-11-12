/**
 * The Explainboard mark: an ensō painted in one stroke, signed with a red seal of 説 ("to explain"),
 * as an ink painting is signed. On the welcome screen the stroke is painted in, then the seal is pressed.
 */
import { useId } from 'react'
import { ensoBrush } from './brush'

const BRUSH = ensoBrush()

export function Mark({ size = 120, animate = true }: { size?: number; animate?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <div className={animate ? 'eb-mark eb-mark-paint' : 'eb-mark'} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <defs>
          {/* rough, inky edges and a little dry grain */}
          <filter id={`${id}ink`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="9" result="speck" />
            <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 2.35" result="dry" />
            <feComposite in="rough" in2="dry" operator="in" />
          </filter>
          {/* the stroke is uncovered along its own centre line, so it looks painted, not wiped */}
          <mask id={`${id}reveal`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <path className="eb-mark-line" d={BRUSH.centre} pathLength={100} />
          </mask>
        </defs>
        <g mask={`url(#${id}reveal)`} filter={`url(#${id}ink)`}>
          <path className="eb-mark-ink" d={BRUSH.outline} />
          <path className="eb-mark-dry" d={BRUSH.dry} />
        </g>
      </svg>
      <svg className="eb-mark-seal" viewBox="0 0 40 40">
        <defs>
          <filter id={`${id}stamp`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="2" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="r" />
            <feTurbulence type="fractalNoise" baseFrequency="1.1" seed="7" result="s" />
            <feColorMatrix in="s" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 2.1" result="m" />
            <feComposite in="r" in2="m" operator="in" />
          </filter>
        </defs>
        <g filter={`url(#${id}stamp)`}>
          <rect x="2" y="2" width="36" height="36" rx="3.5" className="eb-mark-seal-bg" />
          <text x="20" y="21" textAnchor="middle" dominantBaseline="central" className="eb-mark-seal-k">説</text>
        </g>
      </svg>
    </div>
  )
}
