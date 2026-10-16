// Полифилы для старых браузеров (Safari до 15.4 — iPhone 6s/7/SE на iOS 15 и т. п.).
// Их используют библиотеки графиков и разметки; без полифилов эти разделы падают.

if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: (target: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(target, key),
    configurable: true,
    writable: true,
  })
}

if (typeof globalThis.structuredClone !== 'function') {
  const clone = (value: unknown, seen: Map<unknown, unknown>): unknown => {
    if (value === null || typeof value !== 'object') return value
    if (seen.has(value)) return seen.get(value)
    if (value instanceof Date) return new Date(value.getTime())
    if (value instanceof RegExp) return new RegExp(value.source, value.flags)
    if (value instanceof Map) {
      const copy = new Map()
      seen.set(value, copy)
      value.forEach((v, k) => copy.set(clone(k, seen), clone(v, seen)))
      return copy
    }
    if (value instanceof Set) {
      const copy = new Set()
      seen.set(value, copy)
      value.forEach((v) => copy.add(clone(v, seen)))
      return copy
    }
    if (value instanceof Error) {
      const copy = new Error(value.message)
      seen.set(value, copy)
      copy.name = value.name
      copy.stack = value.stack
      return copy
    }
    const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {}
    seen.set(value, copy)
    for (const key of Object.keys(value)) {
      ;(copy as Record<string, unknown>)[key] = clone((value as Record<string, unknown>)[key], seen)
    }
    return copy
  }
  globalThis.structuredClone = ((value: unknown) => clone(value, new Map())) as typeof structuredClone
}
