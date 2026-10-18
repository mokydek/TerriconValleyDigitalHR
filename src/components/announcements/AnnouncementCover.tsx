import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Обложки объявлений: собственные иллюстрации в стиле Jańa Post (без стоковых картинок и эмодзи).
 * Холст 640×260, плоские формы, мягкое движение отдельных деталей (отключается при reduced motion).
 */
export const COVERS = ['launch', 'peak', 'inventory', 'holiday', 'learning', 'branch', 'safety', 'team', 'wellbeing', 'it', 'news'] as const
export type CoverKey = (typeof COVERS)[number]

const G = { d: '#0e470d', m: '#167014', b: '#1b8918', l: '#4cad48', p: '#acdca9', s: '#eef7ee', w: '#ffffff', ink: '#17221a' }

function Bg({ from, to, id }: { from: string; to: string; id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="640" height="260" fill={`url(#${id})`} />
    </>
  )
}

/** Тонкие «маршруты» фоном — фирменный мотив, как на титуле Jana Post */
function Routes({ color = '#ffffff', opacity = 0.14 }: { color?: string; opacity?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth="1.5" opacity={opacity}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${-60 + i * 34} 260 Q ${260 + i * 26} ${120 - i * 14} 700 ${-20 + i * 22}`} />
      ))}
    </g>
  )
}

function Box({ x, y, s = 1, fill = '#d9a35b', tape = '#b9823c' }: { x: number; y: number; s?: number; fill?: string; tape?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect width="56" height="44" rx="4" fill={fill} />
      <rect x="22" width="12" height="44" fill={tape} opacity="0.55" />
      <rect y="0" width="56" height="9" rx="3" fill="#000" opacity="0.06" />
    </g>
  )
}

function Truck({ x, y, s = 1, body = G.w, cab = G.b }: { x: number; y: number; s?: number; body?: string; cab?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect width="120" height="62" rx="6" fill={body} />
      <rect x="10" y="12" width="70" height="8" rx="4" fill={cab} opacity="0.85" />
      <rect x="10" y="26" width="46" height="6" rx="3" fill={cab} opacity="0.35" />
      <path d="M120 18h30l20 22v22h-50z" fill={cab} />
      <rect x="132" y="24" width="20" height="14" rx="3" fill="#cfe9f6" />
      <circle cx="30" cy="66" r="12" fill={G.ink} />
      <circle cx="30" cy="66" r="5" fill="#bbb" />
      <circle cx="140" cy="66" r="12" fill={G.ink} />
      <circle cx="140" cy="66" r="5" fill="#bbb" />
    </g>
  )
}

const ART: Record<CoverKey, ReactNode> = {
  launch: (
    <>
      <Bg id="g-launch" from={G.b} to={G.d} />
      <Routes />
      <circle cx="520" cy="40" r="90" fill={G.l} opacity="0.35" />
      {/* окно приложения */}
      <g className="cover-float">
        <rect x="300" y="38" width="250" height="180" rx="16" fill={G.w} />
        <rect x="300" y="38" width="250" height="34" rx="16" fill={G.s} />
        <circle cx="320" cy="55" r="5" fill={G.p} />
        <circle cx="336" cy="55" r="5" fill={G.p} />
        <rect x="318" y="88" width="98" height="52" rx="10" fill={G.s} />
        <rect x="430" y="88" width="102" height="52" rx="10" fill={G.s} />
        <rect x="330" y="100" width="40" height="8" rx="4" fill={G.b} />
        <rect x="330" y="116" width="62" height="6" rx="3" fill={G.p} />
        <rect x="442" y="100" width="50" height="8" rx="4" fill={G.b} />
        <rect x="442" y="116" width="70" height="6" rx="3" fill={G.p} />
        <rect x="318" y="152" width="214" height="12" rx="6" fill={G.s} />
        <rect x="318" y="152" width="140" height="12" rx="6" fill={G.l} />
        <rect x="318" y="176" width="90" height="26" rx="8" fill={G.b} />
      </g>
      {/* карточки-уведомления */}
      <g className="cover-float-slow">
        <rect x="200" y="150" width="130" height="46" rx="12" fill={G.w} opacity="0.96" />
        <circle cx="222" cy="173" r="11" fill={G.l} />
        <path d="M216 173l4 4 8-8" stroke={G.w} strokeWidth="3" fill="none" strokeLinecap="round" />
        <rect x="240" y="164" width="70" height="7" rx="3.5" fill={G.p} />
        <rect x="240" y="177" width="48" height="6" rx="3" fill={G.s} />
      </g>
      <g className="cover-float">
        <rect x="160" y="66" width="110" height="40" rx="12" fill={G.w} opacity="0.9" />
        <rect x="174" y="80" width="18" height="12" rx="3" fill={G.b} />
        <rect x="200" y="80" width="52" height="6" rx="3" fill={G.p} />
        <rect x="200" y="91" width="34" height="5" rx="2.5" fill={G.s} />
      </g>
    </>
  ),
  peak: (
    <>
      <Bg id="g-peak" from="#123d16" to="#1b8918" />
      <Routes opacity={0.12} />
      <text x="40" y="150" fontSize="118" fontWeight="800" fill="#ffffff" opacity="0.12" fontFamily="Onest, sans-serif">11.11</text>
      <path d="M0 214h640v46H0z" fill="#0e2f10" />
      <path d="M0 230h640" stroke="#ffd56b" strokeWidth="4" strokeDasharray="28 22" className="cover-road" />
      <g className="cover-drive">
        <Truck x={300} y={136} s={0.9} />
      </g>
      <Box x={70} y={170} s={0.8} />
      <Box x={110} y={176} s={0.7} fill="#e3b26a" />
      <Box x={84} y={136} s={0.75} fill="#e8bb77" />
      {/* стрелки роста */}
      <g fill="#ffd56b">
        <path d="M520 120l40-46 40 46h-24v44h-32v-44z" opacity="0.95" />
        <path d="M470 150l24-28 24 28h-14v26h-20v-26z" opacity="0.7" />
      </g>
    </>
  ),
  inventory: (
    <>
      <Bg id="g-inv" from="#f6efe2" to="#e9dcc3" />
      {/* стеллажи */}
      <g fill="#8a6a3f">
        <rect x="60" y="40" width="10" height="200" />
        <rect x="290" y="40" width="10" height="200" />
        <rect x="60" y="100" width="240" height="8" />
        <rect x="60" y="170" width="240" height="8" />
        <rect x="60" y="236" width="240" height="8" />
      </g>
      <Box x={80} y={56} s={0.8} />
      <Box x={130} y={56} s={0.8} fill="#e3b26a" />
      <Box x={220} y={62} s={0.68} />
      <Box x={84} y={128} s={0.8} fill="#e8bb77" />
      <Box x={150} y={126} s={0.84} />
      <Box x={226} y={132} s={0.7} fill="#e3b26a" />
      <Box x={100} y={196} s={0.8} />
      <Box x={190} y={192} s={0.86} fill="#e8bb77" />
      {/* сканер с лучом */}
      <g className="cover-float">
        <rect x="400" y="80" width="80" height="130" rx="16" fill={G.ink} />
        <rect x="410" y="94" width="60" height="70" rx="8" fill="#cfe9d0" />
        <rect x="418" y="106" width="44" height="6" rx="3" fill={G.b} />
        <rect x="418" y="120" width="30" height="6" rx="3" fill={G.l} />
        <rect x="418" y="134" width="38" height="6" rx="3" fill={G.l} />
        <rect x="428" y="176" width="24" height="18" rx="5" fill={G.b} />
      </g>
      <path d="M400 120 L300 100 L300 150 Z" fill="#ff5a5a" opacity="0.18" className="cover-blink" />
      <path d="M300 125h100" stroke="#ff5a5a" strokeWidth="2" className="cover-blink" />
      <circle cx="560" cy="60" r="34" fill={G.b} />
      <path d="M545 60l10 10 20-20" stroke={G.w} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  holiday: (
    <>
      <Bg id="g-hol" from="#00afca" to="#0087a3" />
      {/* солнце и степь в цветах флага Казахстана */}
      <g className="cover-spin" style={{ transformOrigin: '470px 110px' }}>
        {Array.from({ length: 16 }, (_, i) => (
          <rect key={i} x="467" y="20" width="6" height="26" rx="3" fill="#fec50c" transform={`rotate(${i * 22.5} 470 110)`} />
        ))}
      </g>
      <circle cx="470" cy="110" r="46" fill="#fec50c" />
      <path d="M0 200 Q 160 160 320 196 T 640 186 V260 H0z" fill="#33c3d8" opacity="0.6" />
      <path d="M0 226 Q 200 196 400 222 T 640 214 V260 H0z" fill="#1aa0b8" />
      {/* календарь */}
      <g className="cover-float">
        <rect x="90" y="56" width="170" height="160" rx="18" fill={G.w} />
        <rect x="90" y="56" width="170" height="44" rx="18" fill="#fec50c" />
        <rect x="90" y="84" width="170" height="16" fill="#fec50c" />
        <rect x="124" y="44" width="10" height="26" rx="5" fill={G.ink} />
        <rect x="216" y="44" width="10" height="26" rx="5" fill={G.ink} />
        <text x="175" y="176" textAnchor="middle" fontSize="70" fontWeight="800" fill="#0087a3" fontFamily="Onest, sans-serif">25</text>
        <rect x="132" y="190" width="86" height="8" rx="4" fill="#cdeff5" />
      </g>
    </>
  ),
  learning: (
    <>
      <Bg id="g-learn" from="#e6f5e5" to="#bfe6bc" />
      <Routes color={G.m} opacity={0.08} />
      {/* экран с видео */}
      <g className="cover-float">
        <rect x="250" y="40" width="270" height="164" rx="16" fill={G.ink} />
        <rect x="262" y="52" width="246" height="128" rx="10" fill="#244a27" />
        <circle cx="385" cy="116" r="30" fill={G.w} />
        <path d="M376 100v32l26-16z" fill={G.b} />
        <rect x="262" y="188" width="246" height="6" rx="3" fill="#3c6b40" />
        <rect x="262" y="188" width="120" height="6" rx="3" fill={G.l} />
      </g>
      {/* шапка выпускника */}
      <g className="cover-float-slow">
        <path d="M70 120l90-40 90 40-90 40z" fill={G.m} />
        <path d="M110 138v36c28 22 72 22 100 0v-36l-50 22z" fill={G.b} />
        <path d="M250 120v52" stroke="#f5b83d" strokeWidth="5" />
        <circle cx="250" cy="176" r="8" fill="#f5b83d" />
      </g>
      {/* галочки практики */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${548} ${70 + i * 46})`}>
          <rect width="56" height="34" rx="10" fill={G.w} />
          <circle cx="17" cy="17" r="9" fill={i < 2 ? G.b : G.p} />
          {i < 2 && <path d="M12 17l4 4 7-8" stroke={G.w} strokeWidth="2.5" fill="none" strokeLinecap="round" />}
          <rect x="31" y="14" width="18" height="6" rx="3" fill={G.p} />
        </g>
      ))}
    </>
  ),
  branch: (
    <>
      <Bg id="g-branch" from="#dff3de" to="#a9dba5" />
      <path d="M0 210h640v50H0z" fill="#8cc888" />
      {/* здание ПВЗ */}
      <rect x="200" y="86" width="250" height="126" rx="8" fill={G.w} />
      <path d="M190 86h270l-14-34H204z" fill={G.b} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${204 + i * 42} 86h42l-6 18h-30z`} fill={i % 2 ? G.l : G.w} opacity={i % 2 ? 1 : 0.9} />
      ))}
      <rect x="226" y="122" width="80" height="90" rx="6" fill="#cfe9f6" />
      <rect x="264" y="122" width="4" height="90" fill={G.w} />
      <rect x="330" y="122" width="96" height="52" rx="6" fill="#cfe9f6" />
      <rect x="350" y="70" width="60" height="12" rx="6" fill={G.w} opacity="0.95" />
      {/* метка на карте */}
      <g className="cover-bounce">
        <path d="M520 150c-26-30-40-52-40-72a40 40 0 0 1 80 0c0 20-14 42-40 72z" fill="#ef4444" />
        <circle cx="520" cy="78" r="15" fill={G.w} />
      </g>
      <ellipse cx="520" cy="206" rx="26" ry="6" fill="#000" opacity="0.12" />
      <Box x={110} y={170} s={0.75} />
    </>
  ),
  safety: (
    <>
      <Bg id="g-safe" from="#ffd34d" to="#f5b20f" />
      {/* сигнальная полоса */}
      <g>
        <rect y="218" width="640" height="42" fill={G.ink} />
        {Array.from({ length: 18 }, (_, i) => (
          <path key={i} d={`M${i * 40 - 20} 260l28-42h20l-28 42z`} fill="#ffd34d" />
        ))}
      </g>
      {/* каска */}
      <g className="cover-float">
        <path d="M200 176a110 96 0 0 1 220 0z" fill="#f97316" />
        <path d="M296 84h28v94h-28z" fill="#fb923c" />
        <rect x="170" y="172" width="280" height="22" rx="11" fill="#ea580c" />
        <path d="M230 150c10-34 40-58 80-62" stroke="#fdba74" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.7" />
      </g>
      {/* щит с галочкой */}
      <g className="cover-float-slow">
        <path d="M520 44l56 20v40c0 40-26 66-56 78-30-12-56-38-56-78V64z" fill={G.b} />
        <path d="M498 106l16 16 30-32" stroke={G.w} strokeWidth="9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="80" cy="70" r="30" fill={G.w} opacity="0.35" />
      <circle cx="110" cy="130" r="14" fill={G.w} opacity="0.3" />
    </>
  ),
  team: (
    <>
      <Bg id="g-team" from={G.l} to={G.m} />
      <Routes />
      {/* люди */}
      {[
        { x: 170, c: '#f4c7a1', s: '#ffffff', h: 0 },
        { x: 270, c: '#e0ac7e', s: '#d6eed5', h: -14 },
        { x: 370, c: '#f1c39c', s: '#ffffff', h: 0 },
      ].map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.h})`}>
          <path d="M-46 260v-56a46 46 0 0 1 92 0v56z" fill={p.s} />
          <circle cx="0" cy="130" r="30" fill={p.c} />
          <path d="M-30 122a30 30 0 0 1 60 0c-8-10-18-14-30-14s-22 4-30 14z" fill={G.ink} opacity="0.85" />
        </g>
      ))}
      {/* кубок */}
      <g className="cover-bounce">
        <path d="M500 60h80v26a40 40 0 0 1-80 0z" fill="#f5b83d" />
        <path d="M500 70h-18a18 18 0 0 0 18 28M580 70h18a18 18 0 0 1-18 28" stroke="#f5b83d" strokeWidth="7" fill="none" />
        <rect x="530" y="124" width="20" height="26" fill="#e0a12c" />
        <rect x="514" y="150" width="52" height="12" rx="4" fill="#e0a12c" />
      </g>
      {[[460, 50], [610, 120], [480, 150]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 9}l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z`} fill="#ffe08a" className="cover-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
      ))}
    </>
  ),
  wellbeing: (
    <>
      <Bg id="g-well" from="#eaf6ef" to="#cbe8d6" />
      <circle cx="140" cy="130" r="92" fill="#d9f0e1" />
      {/* листья */}
      <g className="cover-sway" style={{ transformOrigin: '140px 220px' }}>
        <path d="M140 220c0-60 0-100 0-120" stroke={G.m} strokeWidth="5" />
        <path d="M140 150c-40-4-62-28-64-58 34 0 58 22 64 58z" fill={G.l} />
        <path d="M140 124c34-6 54-30 54-60-30 2-50 24-54 60z" fill={G.b} />
      </g>
      {/* сердце */}
      <g className="cover-pulse" style={{ transformOrigin: '360px 120px' }}>
        <path d="M360 186s-82-46-82-100a44 44 0 0 1 82-22 44 44 0 0 1 82 22c0 54-82 100-82 100z" fill="#f87171" />
        <path d="M300 104h28l12-20 16 40 12-20h40" stroke={G.w} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* кружка */}
      <g transform="translate(500 120)">
        <rect width="70" height="80" rx="12" fill={G.w} />
        <path d="M70 18h12a16 16 0 0 1 0 32H70" stroke={G.w} strokeWidth="9" fill="none" />
        <path d="M18 -10c0-10 10-10 10-20M38 -10c0-10 10-10 10-20" stroke="#9cc9ac" strokeWidth="4" fill="none" strokeLinecap="round" className="cover-steam" />
        <rect x="12" y="26" width="46" height="8" rx="4" fill="#cbe8d6" />
      </g>
    </>
  ),
  it: (
    <>
      <Bg id="g-it" from="#0f2a2f" to="#163b2a" />
      {/* сетка */}
      <g stroke="#2e6a4f" strokeWidth="1" opacity="0.5">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={`v${i}`} d={`M${i * 56} 0v260`} />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <path key={`h${i}`} d={`M0 ${i * 56}h640`} />
        ))}
      </g>
      {/* ТСД */}
      <g className="cover-float">
        <rect x="140" y="50" width="96" height="170" rx="18" fill="#26302a" />
        <rect x="152" y="66" width="72" height="96" rx="8" fill="#0f2a2f" />
        <rect x="160" y="78" width="56" height="8" rx="4" fill={G.l} />
        <rect x="160" y="94" width="40" height="6" rx="3" fill="#3b7f5a" />
        <rect x="160" y="108" width="48" height="6" rx="3" fill="#3b7f5a" />
        <rect x="172" y="176" width="32" height="24" rx="6" fill={G.b} />
      </g>
      {/* щит с замком */}
      <g className="cover-float-slow">
        <path d="M420 34l92 30v62c0 62-42 100-92 116-50-16-92-54-92-116V64z" fill={G.b} />
        <rect x="394" y="118" width="52" height="44" rx="8" fill={G.w} />
        <path d="M404 118v-14a16 16 0 0 1 32 0v14" stroke={G.w} strokeWidth="8" fill="none" />
        <circle cx="420" cy="138" r="6" fill={G.b} />
      </g>
      {/* звёздочки пароля */}
      <g fill={G.p} className="cover-blink">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx={268 + i * 18} cy={210} r="5" />
        ))}
      </g>
    </>
  ),
  news: (
    <>
      <Bg id="g-news" from={G.s} to={G.p} />
      <Routes color={G.m} opacity={0.12} />
      <g className="cover-float">
        <rect x="190" y="44" width="260" height="176" rx="14" fill={G.w} />
        <rect x="210" y="64" width="140" height="14" rx="7" fill={G.b} />
        <rect x="210" y="90" width="100" height="70" rx="8" fill={G.p} />
        <rect x="324" y="92" width="106" height="8" rx="4" fill={G.s} />
        <rect x="324" y="108" width="90" height="8" rx="4" fill={G.s} />
        <rect x="324" y="124" width="100" height="8" rx="4" fill={G.s} />
        <rect x="210" y="176" width="220" height="8" rx="4" fill={G.s} />
        <rect x="210" y="192" width="160" height="8" rx="4" fill={G.s} />
      </g>
      <g className="cover-wiggle-slow" style={{ transformOrigin: '520px 120px' }}>
        <path d="M480 100l60-30v100l-60-30z" fill={G.b} />
        <rect x="462" y="100" width="20" height="40" rx="5" fill={G.m} />
      </g>
    </>
  ),
}

export function AnnouncementCover({ cover, image, className, alt = '' }: { cover?: string | null; image?: string | null; className?: string; alt?: string }) {
  if (image)
    return (
      <div className={cn('overflow-hidden bg-canvas', className)}>
        <img src={image} alt={alt} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
      </div>
    )
  const key = (COVERS as readonly string[]).includes(cover ?? '') ? (cover as CoverKey) : 'news'
  return (
    <div className={cn('cover-art overflow-hidden', className)} aria-hidden>
      <svg viewBox="0 0 640 260" preserveAspectRatio="xMidYMid slice" className="h-full w-full transition duration-500 group-hover:scale-[1.03]">
        {ART[key]}
      </svg>
    </div>
  )
}
