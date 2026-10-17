#!/usr/bin/env node
/**
 * Проверка переводов.
 * 1. В коде (src, кроме src/locales) нет строк с кириллицей: весь текст интерфейса идёт через словари.
 *    Исключения: console.*, строка с комментарием «i18n-ignore», блок i18n-ignore-start … i18n-ignore-end,
 *    файл с пометкой i18n-ignore-file.
 * 2. Словари: у каждого языка те же ключи, что у русского, без лишних и пустых; те же {переменные};
 *    нет длинного тире; в английском и узбекском (латиница) нет кириллицы; ключи не повторяются между разделами.
 *
 *   node scripts/check-i18n.mjs                 всё
 *   node scripts/check-i18n.mjs src/pages/A.tsx только эти файлы кода (словари проверяются всегда)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const CYR = /[Ѐ-ӿ]/
const problems = []
const warn = (msg) => problems.push(msg)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (p.endsWith(join('src', 'locales'))) continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/* ---------- 1. Код ---------- */

const args = process.argv.slice(2)
const codeFiles = args.length ? args.map((a) => join(root, a)) : walk(join(root, 'src'))

for (const file of codeFiles) {
  const text = readFileSync(file, 'utf8')
  if (text.includes('i18n-ignore-file')) continue
  const lines = text.split('\n')
  const ignored = new Set()
  let block = false
  lines.forEach((line, i) => {
    if (line.includes('i18n-ignore-start')) block = true
    if (block || /i18n-ignore(?!-)/.test(line)) ignored.add(i)
    if (line.includes('i18n-ignore-end')) block = false
  })
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(sf) === 'console') return
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    if (isText && CYR.test(node.text)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
      if (!ignored.has(line)) warn(`${relative(root, file)}:${line + 1}: текст без перевода: ${node.text.trim().slice(0, 80)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/* ---------- 2. Словари ---------- */

const localesDir = join(root, 'src', 'locales')
const langs = readdirSync(localesDir).filter((d) => statSync(join(localesDir, d)).isDirectory())
const LATIN_ONLY = new Set(['en', 'uz'])

/** Ключи и значения из файла словаря (объект в export default) */
function readDict(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map()
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name))) {
      const key = node.name.text
      const init = node.initializer
      const value = ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) ? init.text : null
      if (out.has(key)) warn(`${relative(root, file)}: ключ «${key}» указан дважды`)
      out.set(key, value)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * Переменные строки: bare — выводятся как {x}, all — все, включая выбор формы {x|…}.
 * Перевод обязан выводить все bare-переменные русского текста; переменная, которая в русском нужна
 * только для выбора формы слова ({c|день|дня|дней}), в языках без форм может не использоваться.
 */
const varsOf = (s) => {
  const bare = new Set()
  const all = new Set()
  for (const m of s.matchAll(/\{(\w+)(\|[^{}]*)?\}/g)) {
    all.add(m[1])
    if (!m[2]) bare.add(m[1])
  }
  return { bare, all }
}
const varsProblem = (v, rv) => {
  const a = varsOf(v)
  const r = varsOf(rv)
  const lost = [...r.bare].filter((x) => !a.bare.has(x))
  const unknown = [...a.all].filter((x) => !r.all.has(x))
  if (!lost.length && !unknown.length) return null
  return [lost.length ? `нет {${lost.join('}, {')}}` : '', unknown.length ? `лишние {${unknown.join('}, {')}}` : ''].filter(Boolean).join('; ')
}

const namespaces = readdirSync(join(localesDir, 'ru')).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
const owner = new Map()
const ru = new Map()
for (const ns of namespaces) {
  for (const [k, v] of readDict(join(localesDir, 'ru', ns))) {
    if (owner.has(k)) warn(`src/locales/ru: ключ «${k}» есть и в ${owner.get(k)}, и в ${ns}`)
    owner.set(k, ns)
    ru.set(k, v)
    if (v !== null && v.includes('—')) warn(`src/locales/ru/${ns}: «${k}» содержит длинное тире`)
  }
}

let missing = 0
for (const lang of langs.filter((l) => l !== 'ru')) {
  for (const ns of namespaces) {
    const file = join(localesDir, lang, ns)
    let dict
    try {
      dict = readDict(file)
    } catch {
      warn(`src/locales/${lang}/${ns}: файла нет`)
      continue
    }
    for (const [k, rv] of ru) {
      if (owner.get(k) !== ns) continue
      if (!dict.has(k)) {
        missing++
        if (missing <= 40) warn(`src/locales/${lang}/${ns}: нет перевода «${k}»`)
        continue
      }
      const v = dict.get(k)
      if (v === null) continue
      if (!v.trim() && rv?.trim()) warn(`src/locales/${lang}/${ns}: пустой перевод «${k}»`)
      const vp = rv !== null ? varsProblem(v, rv) : null
      if (vp) warn(`src/locales/${lang}/${ns}: «${k}» переменные: ${vp}`)
      if (v.includes('—')) warn(`src/locales/${lang}/${ns}: «${k}» содержит длинное тире`)
      if (LATIN_ONLY.has(lang) && CYR.test(v.replace(/1С:ЗУП/g, ''))) warn(`src/locales/${lang}/${ns}: «${k}» кириллица в латинском языке: ${v.slice(0, 60)}`)
    }
    for (const k of dict.keys()) if (owner.get(k) !== ns) warn(`src/locales/${lang}/${ns}: лишний ключ «${k}»`)
  }
}
if (missing > 40) warn(`… и ещё ${missing - 40} ключей без перевода`)

if (problems.length) {
  console.log(problems.join('\n'))
  console.log(`\nНайдено проблем: ${problems.length}`)
  process.exit(1)
}
console.log(`Переводы в порядке: ${ru.size} ключей, языков: ${langs.length}`)
