import { toast } from 'sonner'
import { t } from './i18n'

type Cell = string | number | null | undefined

/** Выгрузка таблицы в .xlsx (библиотека грузится по требованию) */
export async function exportXlsx(title: string, columns: string[], rows: Cell[][]) {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const header = columns.map((c) => ({ value: c, fontWeight: 'bold' as const, backgroundColor: '#EEF8EE' }))
    const body = rows.map((r) => r.map((v) => ({ value: v === null || v === undefined ? '' : v })))
    await writeXlsxFile([header, ...body], {
      sheet: title.slice(0, 31),
      columns: columns.map((c) => ({ width: Math.max(12, Math.min(40, c.length + 6)) })),
      stickyRowsCount: 1,
    }).toFile(`${title} ${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(t('excel.done'))
  } catch (e) {
    console.error(e)
    toast.error(t('excel.failed'))
  }
}
