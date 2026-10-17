import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { must, supabase } from './supabase'
import { useAuth } from './auth'
import { t } from './i18n'

/** Фото сотрудников, у кого оно есть: id сотрудника → data URL */
export function useAvatars() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['avatars'],
    queryFn: async () => {
      const rows = (await must(supabase.from('employee_avatars').select('employee_id,image'))) as { employee_id: string; image: string }[]
      return new Map(rows.map((r) => [r.employee_id, r.image]))
    },
    enabled: Boolean(me),
    staleTime: 60_000,
  })
}

export function useAvatar(id?: string | null): string | undefined {
  const { data } = useAvatars()
  return id ? data?.get(id) : undefined
}

const SIZE = 256

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('photo.bad')))
    }
    img.src = url
  })
}

/** Квадрат 256×256 из середины картинки, JPEG ~20–40 КБ: такое фото не нагружает базу и грузится мгновенно */
export async function imageToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(t('photo.bad'))
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (!side) throw new Error(t('photo.bad'))
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('photo.bad'))
  ctx.fillStyle = '#ffffff' // прозрачный PNG иначе станет чёрным
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE)
  return canvas.toDataURL('image/jpeg', 0.86)
}

export function useSetAvatar() {
  const { me } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (image: string) => must(supabase.from('employee_avatars').upsert({ employee_id: me!.id, image })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['avatars'] }),
  })
}

export function useRemoveAvatar() {
  const { me } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => must(supabase.from('employee_avatars').delete().eq('employee_id', me!.id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['avatars'] }),
  })
}
