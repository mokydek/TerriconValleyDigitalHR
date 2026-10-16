import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Детерминированный цвет аватара по строке */
export function colorFor(seed: string): string {
  const palette = ['#168f12', '#0e7490', '#7c3aed', '#c2410c', '#be185d', '#1d4ed8', '#0f766e', '#a16207', '#4d7c0f', '#9333ea']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}
