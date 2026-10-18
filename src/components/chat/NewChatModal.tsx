import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Camera, Megaphone, MessageCircle, Users } from '@/components/icons'
import { useI18n } from '@/lib/i18n'
import { useEmployeesLite } from '@/lib/api'
import { useCreateGroupChat, useOpenDirectChat } from '@/lib/chat'
import { squareAvatar } from '@/lib/chatMedia'
import { cn } from '@/lib/utils'
import { Button, Field, Modal } from '@/components/ui'
import { PeoplePicker } from './PeoplePicker'

type Mode = 'direct' | 'group' | 'channel'

/** Новый чат: личный, группа или канал (в канале пишут только админы) */
export function NewChatModal({ open, onClose, onOpened, initialMode = 'direct' }: { open: boolean; onClose: () => void; onOpened: (chatId: string) => void; initialMode?: Mode }) {
  const { t } = useI18n()
  const people = useEmployeesLite()
  const openDirect = useOpenDirectChat()
  const createGroup = useCreateGroupChat()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    setPicked([])
    setTitle('')
    setDescription('')
    setAvatar(null)
  }, [open, initialMode])

  const byId = new Map((people.data ?? []).map((p) => [p.id, p]))
  const defaultTitle =
    picked
      .slice(0, 3)
      .map((id) => byId.get(id)?.first_name)
      .filter(Boolean)
      .join(', ') + (picked.length > 3 ? '…' : '')
  const busy = openDirect.isPending || createGroup.isPending
  const onError = (e: unknown) => toast.error((e as Error).message)
  const ready = mode === 'direct' ? picked.length === 1 : picked.length >= 1 && (mode === 'group' || title.trim())

  const start = () => {
    if (mode === 'direct') openDirect.mutate(picked[0], { onSuccess: onOpened, onError })
    else
      createGroup.mutate(
        { title: title.trim() || defaultTitle, members: picked, kind: mode, description: description.trim(), avatar },
        { onSuccess: onOpened, onError },
      )
  }

  const modes: { value: Mode; label: string; Icon: typeof Users; hint: string }[] = [
    { value: 'direct', label: t('msg.newDirect'), Icon: MessageCircle, hint: t('msg.newDirectHint') },
    { value: 'group', label: t('msg.newGroup'), Icon: Users, hint: t('msg.newGroupHint') },
    { value: 'channel', label: t('msg.newChannel'), Icon: Megaphone, hint: t('msg.newChannelHint') },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('chat.new')}
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">{picked.length > 0 && mode !== 'direct' && t('chat.selected', { n: picked.length })}</span>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!ready} loading={busy} onClick={start} data-testid="chat-start">
            {mode === 'direct' ? t('chat.write') : mode === 'group' ? t('chat.createGroup') : t('msg.createChannel')}
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-2" role="radiogroup">
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            onClick={() => {
              setMode(m.value)
              if (m.value === 'direct') setPicked((cur) => cur.slice(0, 1))
            }}
            className={cn(
              'flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center transition active:scale-[0.98]',
              mode === m.value ? 'border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-200' : 'border-line hover:border-brand-300',
            )}
            data-testid={`new-${m.value}`}
          >
            <m.Icon className="h-5 w-5" />
            <span className="text-sm font-semibold">{m.label}</span>
            <span className="hidden text-[11px] leading-tight text-muted sm:block">{m.hint}</span>
          </button>
        ))}
      </div>

      {mode !== 'direct' && (
        <div className="mb-4 flex items-start gap-3">
          <button
            type="button"
            onClick={() => file.current?.click()}
            className="group relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100 hover:bg-brand-100"
            aria-label={t('msg.groupPhoto')}
            title={t('msg.groupPhoto')}
          >
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <Camera className="h-6 w-6 transition group-hover:scale-110" />}
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <Field label={mode === 'channel' ? t('msg.channelName') : t('chat.groupName')}>
              <input className="field" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={mode === 'group' ? defaultTitle : ''} data-testid="chat-group-title" />
            </Field>
            <Field label={t('msg.description')}>
              <input className="field" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder={t('msg.descriptionHint')} />
            </Field>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) setAvatar(await squareAvatar(f).catch(() => null))
            }}
          />
        </div>
      )}
      <PeoplePicker picked={picked} onChange={setPicked} single={mode === 'direct'} maxHeight={mode === 'direct' ? '50dvh' : '34dvh'} />
    </Modal>
  )
}
