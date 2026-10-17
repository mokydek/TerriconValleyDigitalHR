import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { imageToAvatar, useSetAvatar } from '@/lib/avatars'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'

/**
 * Выбор фото профиля: скрытое поле файла (держите его смонтированным, пока идёт выбор)
 * и функция, которая открывает окно выбора.
 */
export function usePhotoPicker() {
  const ref = useRef<HTMLInputElement>(null)
  const setAvatar = useSetAvatar()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      className="hidden"
      data-testid="avatar-input"
      onChange={async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        setBusy(true)
        try {
          await setAvatar.mutateAsync(await imageToAvatar(file))
          toast.success(t('photo.updated'))
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('photo.bad'))
        } finally {
          setBusy(false)
        }
      }}
    />
  )
  return { input, pick: () => ref.current?.click(), busy }
}

/** Аватар текущего пользователя с кнопкой смены фото */
export function MyPhoto({ size = 64 }: { size?: number }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const photo = usePhotoPicker()
  if (!me) return null
  return (
    <span className="relative inline-flex shrink-0">
      {photo.input}
      <button type="button" onClick={photo.pick} className="group relative rounded-full" title={t('menu.changePhoto')} aria-label={t('menu.changePhoto')}>
        <Avatar id={me.id} name={fullName(me)} size={size} />
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-brand-600 text-white ring-2 ring-white transition group-hover:bg-brand-700',
            size >= 60 ? 'h-7 w-7' : 'h-6 w-6',
          )}
        >
          {photo.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
        </span>
      </button>
    </span>
  )
}
