import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Собственные значки курсов Jana Academy вместо эмодзи: двухтоновые, в фирменной гамме Jańa Post.
 * Рисунок 48×48, контур #167014, заливка-подложка #d6eed5.
 */
const LINE = '#167014'
const FILL = '#acdca9'
const SOFT = '#eef7ee'

const ART: Record<string, ReactNode> = {
  // Посылка с лентой: адаптация, «кто мы»
  box: (
    <>
      <path d="M24 8 39 15v18l-15 7-15-7V15z" fill={FILL} />
      <path d="M24 8 39 15v18l-15 7-15-7V15z" />
      <path d="M9 15l15 7 15-7M24 22v18" />
      <path d="M16.5 11.5l15 7v6" />
    </>
  ),
  // Каска: охрана труда
  helmet: (
    <>
      <path d="M10 31a14 14 0 0 1 28 0z" fill={FILL} />
      <path d="M10 31a14 14 0 0 1 28 0" />
      <path d="M7 31h34v4H7z" />
      <path d="M24 17v-4M19.5 18.5 18 15M28.5 18.5 30 15" />
    </>
  ),
  // Замок со щитом: информационная безопасность
  lock: (
    <>
      <rect x="11" y="21" width="26" height="19" rx="4" fill={FILL} />
      <rect x="11" y="21" width="26" height="19" rx="4" />
      <path d="M16 21v-5a8 8 0 0 1 16 0v5" />
      <circle cx="24" cy="29.5" r="2.5" />
      <path d="M24 32v3" />
    </>
  ),
  // Гарнитура: клиентский сервис
  headset: (
    <>
      <rect x="8" y="23" width="7" height="11" rx="3" fill={FILL} />
      <rect x="33" y="23" width="7" height="11" rx="3" fill={FILL} />
      <path d="M11.5 23v-2a12.5 12.5 0 0 1 25 0v2" />
      <rect x="8" y="23" width="7" height="11" rx="3" />
      <rect x="33" y="23" width="7" height="11" rx="3" />
      <path d="M36.5 34v1a5 5 0 0 1-5 5H26" />
      <circle cx="24" cy="40" r="2" />
    </>
  ),
  // Книга: общий
  book: (
    <>
      <path d="M24 13c-4-3-9-3.5-15-2.5v24c6-1 11-.5 15 2.5 4-3 9-3.5 15-2.5v-24c-6-1-11-.5-15 2.5z" fill={FILL} />
      <path d="M24 13c-4-3-9-3.5-15-2.5v24c6-1 11-.5 15 2.5 4-3 9-3.5 15-2.5v-24c-6-1-11-.5-15 2.5zM24 13v24" />
    </>
  ),
  // Грузовик: логистика
  truck: (
    <>
      <rect x="6" y="14" width="22" height="17" rx="2" fill={FILL} />
      <path d="M6 14h22v17H6zM28 20h7l6 6v5H28" />
      <circle cx="14" cy="34" r="3.5" fill={SOFT} />
      <circle cx="34" cy="34" r="3.5" fill={SOFT} />
    </>
  ),
}

export function CourseIcon({ name, className }: { name?: string | null; className?: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-100 ring-inset', className ?? 'h-12 w-12')}>
      <svg
        viewBox="0 0 48 48"
        className="h-[68%] w-[68%]"
        fill="none"
        stroke={LINE}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {ART[name ?? ''] ?? ART.book}
      </svg>
    </span>
  )
}
