import { useEffect, useRef } from 'react'

/**
 * Живой фон экрана входа: переливающееся «северное сияние» в зелёной гамме Jańa Post
 * и маршруты, по которым бегут огоньки-посылки (мотив логистики Китай → Казахстан → Центральная Азия).
 * Слои слегка смещаются за курсором. При prefers-reduced-motion всё стоит на месте.
 */
const ROUTES = [
  'M -60 720 C 180 560, 320 600, 480 430 S 760 180, 980 120',
  'M -80 620 C 140 520, 300 460, 430 360 S 700 120, 960 40',
  'M -40 820 C 220 700, 420 720, 560 560 S 800 360, 1000 300',
  'M 40 900 C 200 760, 280 620, 420 520 S 640 420, 980 420',
  'M -100 480 C 120 420, 260 300, 420 260 S 700 220, 980 -20',
  'M 120 920 C 300 820, 520 820, 640 680 S 840 520, 1000 560',
]

export function LoginArt() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', String((e.clientX - r.left) / r.width - 0.5))
        el.style.setProperty('--my', String((e.clientY - r.top) / r.height - 0.5))
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={root} className="login-art pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Сияние: три пятна плывут и смешиваются */}
      <div className="login-blob login-blob-a" />
      <div className="login-blob login-blob-b" />
      <div className="login-blob login-blob-c" />

      {/* Маршруты и бегущие посылки */}
      <svg className="login-routes absolute inset-0 h-full w-full" viewBox="0 0 960 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="login-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="login-line" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#4cad48" stopOpacity="0" />
            <stop offset="0.45" stopColor="#7cc678" stopOpacity="0.55" />
            <stop offset="1" stopColor="#d6eed5" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {ROUTES.map((d, i) => (
          <g key={i}>
            <path d={d} fill="none" stroke="url(#login-line)" strokeWidth={i % 2 ? 1.2 : 1.8} />
            <path d={d} fill="none" stroke="#acdca9" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 22" className="login-flow" style={{ animationDuration: `${7 + i * 1.7}s` }} opacity="0.55" />
            {i % 2 === 0 && (
              <circle r="4.5" fill="#eef7ee" filter="url(#login-glow)">
                <animateMotion dur={`${9 + i * 2.3}s`} repeatCount="indefinite" path={d} begin={`${-i * 1.9}s`} />
              </circle>
            )}
          </g>
        ))}
        {/* узлы маршрута: хабы, «дышат» */}
        {[
          [480, 430],
          [430, 360],
          [560, 560],
          [420, 260],
          [640, 680],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <circle r="14" fill="#7cc678" opacity="0.16" className="login-hub" style={{ animationDelay: `${i * 0.7}s` }} />
            <circle r="4" fill="#d6eed5" />
          </g>
        ))}
      </svg>

      {/* Лёгкая виньетка, чтобы текст читался */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_55%,transparent_0%,rgba(8,26,11,0.55)_75%)]" />
    </div>
  )
}
