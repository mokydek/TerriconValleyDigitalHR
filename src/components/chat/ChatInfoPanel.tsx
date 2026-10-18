import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Bell,
  BellOff,
  Camera,
  Crown,
  ExternalLink,
  LogOut,
  MessageCircle,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Play,
  Shield,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import {
  useAddChatMembers,
  useChatMedia,
  useLeaveChat,
  useOpenDirectChat,
  useRemoveChatMember,
  useSetChatMemberRole,
  useSetChatPrefs,
  useUpdateChat,
} from '@/lib/chat'
import { extractLinks, squareAvatar } from '@/lib/chatMedia'
import { fmtDate, fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar, Button, Field, Modal, Skeleton } from '@/components/ui'
import type { ChatAttachment, ChatInfo, ChatListItem, ChatMember, ChatMessage } from '@/lib/types'
import { FileCard, VoicePlayer } from './attachments'
import { PeoplePicker } from './PeoplePicker'
import { ChatAvatar, FloatingMenu, MenuButton, useChatTitle } from './shared'

type Tab = 'members' | 'media' | 'files' | 'voice' | 'links'

export function ChatInfoPanel({
  chatId,
  chat,
  info,
  members,
  messages,
  onClose,
  onOpenMedia,
  onLeft,
}: {
  chatId: string
  chat?: ChatListItem
  info?: ChatInfo | null
  members: ChatMember[]
  messages: ChatMessage[]
  onClose: () => void
  onOpenMedia: (items: ChatAttachment[], index: number) => void
  onLeft: () => void
}) {
  const { me } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const title = useChatTitle()
  const prefs = useSetChatPrefs()
  const leave = useLeaveChat()
  const kind = info?.kind ?? chat?.kind ?? 'direct'
  const isGroup = kind === 'group' || kind === 'channel'
  const myRole = members.find((m) => m.employee_id === me?.id)?.role ?? chat?.my_role ?? 'member'
  const isAdmin = myRole === 'owner' || myRole === 'admin'
  const [tab, setTab] = useState<Tab>(isGroup ? 'members' : 'media')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const peer = kind === 'direct' ? members.find((m) => m.employee_id !== me?.id)?.employee : null
  const displayTitle = kind === 'direct' ? fullName(peer ?? undefined) : title({ kind, title: info?.title ?? chat?.title ?? null })
  const onError = (e: unknown) => toast.error((e as Error).message)

  const subtitle =
    kind === 'direct'
      ? (peer?.position ?? '')
      : kind === 'channel'
        ? t('msg.subscribers', { n: members.length })
        : kind === 'group'
          ? t('chat.members', { n: members.length })
          : t('msg.savedHint')

  const tabs: { value: Tab; label: string }[] = [
    ...(isGroup ? [{ value: 'members' as Tab, label: t('msg.tab.members') }] : []),
    { value: 'media', label: t('msg.tab.media') },
    { value: 'files', label: t('msg.tab.files') },
    { value: 'voice', label: t('msg.tab.voice') },
    { value: 'links', label: t('msg.tab.links') },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" data-testid="chat-info">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="font-semibold">{t('msg.info')}</span>
        <div className="flex items-center gap-1">
          {isGroup && isAdmin && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-brand-700" aria-label={t('msg.editChat')} title={t('msg.editChat')} data-testid="chat-edit">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {editing && info ? (
          <EditChat info={info} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex flex-col items-center px-5 pt-6 pb-4 text-center">
            <ChatAvatar chat={{ kind, title: displayTitle, peer_id: peer?.id ?? chat?.peer_id, avatar: info?.avatar ?? chat?.avatar }} size={88} />
            <div className="mt-3 text-lg font-bold text-ink">{displayTitle}</div>
            <div className="text-sm text-muted">{subtitle}</div>
            {info?.description && <p className="mt-2 text-sm whitespace-pre-wrap text-ink-soft">{info.description}</p>}
            {isGroup && info && <p className="mt-1 text-xs text-muted">{t('msg.createdOn', { date: fmtDate(info.created_at, 'd MMMM yyyy') })}</p>}
          </div>
        )}

        {chat && kind !== 'saved' && (
          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            <Button
              variant="soft"
              size="sm"
              icon={chat.muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              onClick={() => prefs.mutate({ chatId, muted: !chat.muted }, { onError })}
              data-testid="chat-mute"
            >
              {chat.muted ? t('msg.unmute') : t('msg.mute')}
            </Button>
            <Button
              variant="soft"
              size="sm"
              icon={chat.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              onClick={() => prefs.mutate({ chatId, pinned: !chat.pinned }, { onError })}
              data-testid="chat-pin"
            >
              {chat.pinned ? t('msg.unpinChat') : t('msg.pinChat')}
            </Button>
          </div>
        )}

        <div className="scrollbar-thin flex gap-1 overflow-x-auto border-y border-line px-3 py-2">
          {tabs.map((x) => (
            <button
              key={x.value}
              type="button"
              onClick={() => setTab(x.value)}
              className={cn('shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition', tab === x.value ? 'bg-brand-600 text-white' : 'text-ink-soft hover:bg-canvas')}
              data-testid={`info-tab-${x.value}`}
            >
              {x.label}
            </button>
          ))}
        </div>

        <div className="px-3 py-3">
          {tab === 'members' && (
            <MembersList
              chatId={chatId}
              kind={kind}
              members={members}
              myRole={myRole}
              onAdd={() => setAdding(true)}
              onOpenDirect={(id) => navigate(`/messages?chat=${id}`)}
            />
          )}
          {tab === 'media' && <MediaGrid chatId={chatId} onOpen={onOpenMedia} />}
          {tab === 'files' && <AttachmentList chatId={chatId} kind="file" />}
          {tab === 'voice' && <AttachmentList chatId={chatId} kind="voice" />}
          {tab === 'links' && <LinksList messages={messages} />}
        </div>

        {isGroup && (
          <div className="border-t border-line px-4 py-4">
            {confirmLeave ? (
              <div className="rounded-2xl bg-rose-50 p-3 text-sm">
                <p className="text-rose-800">{myRole === 'owner' ? t('msg.leaveOwnerWarn') : t('msg.leaveWarn')}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    loading={leave.isPending}
                    onClick={() => leave.mutate(chatId, { onSuccess: onLeft, onError })}
                    data-testid="chat-leave-confirm"
                  >
                    {t('msg.leave')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmLeave(true)} className="flex items-center gap-2 text-sm font-medium text-rose-600 hover:underline" data-testid="chat-leave">
                <LogOut className="h-4 w-4" /> {kind === 'channel' ? t('msg.leaveChannel') : t('msg.leaveGroup')}
              </button>
            )}
          </div>
        )}
      </div>
      <AddMembersModal open={adding} onClose={() => setAdding(false)} chatId={chatId} exclude={members.map((m) => m.employee_id)} />
    </div>
  )
}

/* ---------- Изменить группу ---------- */

function EditChat({ info, onDone }: { info: ChatInfo; onDone: () => void }) {
  const { t } = useI18n()
  const update = useUpdateChat()
  const [title, setTitle] = useState(info.title ?? '')
  const [description, setDescription] = useState(info.description ?? '')
  const [avatar, setAvatar] = useState<string | null>(info.avatar)
  const file = useRef<HTMLInputElement>(null)
  const save = () =>
    update.mutate(
      {
        chatId: info.id,
        title: title.trim() !== (info.title ?? '') ? title.trim() : undefined,
        description: description.trim() !== (info.description ?? '') ? description.trim() : undefined,
        avatar: avatar && avatar !== info.avatar ? avatar : undefined,
        clearAvatar: !avatar && Boolean(info.avatar),
      },
      { onSuccess: onDone, onError: (e) => toast.error((e as Error).message) },
    )
  return (
    <div className="space-y-3 px-5 py-5" data-testid="chat-edit-form">
      <div className="flex justify-center">
        <div className="relative">
          <button type="button" onClick={() => file.current?.click()} className="group relative grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <Camera className="h-7 w-7" />}
            <span className="absolute inset-0 grid place-items-center bg-ink/40 text-white opacity-0 transition group-hover:opacity-100">
              <Camera className="h-6 w-6" />
            </span>
          </button>
          {avatar && (
            <button type="button" onClick={() => setAvatar(null)} className="absolute -right-1 -bottom-1 grid h-7 w-7 place-items-center rounded-full bg-white text-rose-600 shadow ring-1 ring-line" aria-label={t('common.delete')}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) setAvatar(await squareAvatar(f).catch(() => avatar))
          }}
        />
      </div>
      <Field label={info.kind === 'channel' ? t('msg.channelName') : t('chat.groupName')}>
        <input className="field" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} data-testid="chat-edit-title" />
      </Field>
      <Field label={t('msg.description')}>
        <textarea className="field min-h-[80px]" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder={t('msg.descriptionHint')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" loading={update.isPending} disabled={!title.trim()} onClick={save} data-testid="chat-edit-save">
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

/* ---------- Участники ---------- */

function MembersList({
  chatId,
  kind,
  members,
  myRole,
  onAdd,
  onOpenDirect,
}: {
  chatId: string
  kind: ChatInfo['kind']
  members: ChatMember[]
  myRole: ChatMember['role']
  onAdd: () => void
  onOpenDirect: (chatId: string) => void
}) {
  const { me } = useAuth()
  const { t } = useI18n()
  const remove = useRemoveChatMember()
  const setRole = useSetChatMemberRole()
  const openDirect = useOpenDirectChat()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const canAdd = kind === 'group' || myRole !== 'member'
  const order = { owner: 0, admin: 1, member: 2 }
  const sorted = useMemo(
    () => [...members].sort((a, b) => order[a.role] - order[b.role] || fullName(a.employee ?? undefined).localeCompare(fullName(b.employee ?? undefined))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members],
  )
  const onError = (e: unknown) => toast.error((e as Error).message)
  const target = menu ? members.find((m) => m.employee_id === menu.id) : null
  const canRemove = (m: ChatMember) => m.employee_id !== me?.id && (myRole === 'owner' || (myRole === 'admin' && m.role === 'member'))

  return (
    <div>
      {canAdd && (
        <button type="button" onClick={onAdd} className="mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left font-medium text-brand-700 hover:bg-brand-50" data-testid="chat-add-members">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50">
            <UserPlus className="h-5 w-5" />
          </span>
          {kind === 'channel' ? t('msg.addSubscribers') : t('msg.addMembers')}
        </button>
      )}
      <ul>
        {sorted.map((m) => (
          <li key={m.employee_id} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-canvas" data-testid="chat-member">
            <Avatar id={m.employee_id} name={fullName(m.employee ?? undefined)} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">
                {fullName(m.employee ?? undefined)}
                {m.employee_id === me?.id && <span className="ml-1 font-normal text-muted">({t('chat.you')})</span>}
              </div>
              <div className="truncate text-xs text-muted">{m.employee?.position}</div>
            </div>
            {m.role !== 'member' && (
              <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', m.role === 'owner' ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700')}>
                {m.role === 'owner' ? <Crown className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                {m.role === 'owner' ? t('msg.role.owner') : t('msg.role.admin')}
              </span>
            )}
            {m.employee_id !== me?.id && (
              <button
                type="button"
                onClick={(e) => setMenu({ id: m.employee_id, x: e.clientX, y: e.clientY })}
                className="rounded-lg p-1.5 text-muted opacity-60 transition group-hover:opacity-100 hover:bg-white hover:text-ink"
                aria-label={t('msg.actions')}
                data-testid="member-actions"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {menu && target && (
        <FloatingMenu at={menu} onClose={() => setMenu(null)} width={240}>
          <MenuButton
            icon={<MessageCircle className="h-4 w-4" />}
            onClick={() => {
              setMenu(null)
              openDirect.mutate(target.employee_id, { onSuccess: onOpenDirect, onError })
            }}
          >
            {t('chat.write')}
          </MenuButton>
          {myRole === 'owner' && (
            <MenuButton
              icon={target.role === 'admin' ? <Shield className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              onClick={() => {
                setMenu(null)
                setRole.mutate({ chatId, member: target.employee_id, role: target.role === 'admin' ? 'member' : 'admin' }, { onError })
              }}
              testId="member-admin"
            >
              {target.role === 'admin' ? t('msg.removeAdmin') : t('msg.makeAdmin')}
            </MenuButton>
          )}
          {canRemove(target) && (
            <MenuButton
              danger
              icon={<UserMinus className="h-4 w-4" />}
              onClick={() => {
                setMenu(null)
                remove.mutate({ chatId, member: target.employee_id }, { onError })
              }}
              testId="member-remove"
            >
              {kind === 'channel' ? t('msg.removeSubscriber') : t('msg.removeMember')}
            </MenuButton>
          )}
        </FloatingMenu>
      )}
    </div>
  )
}

function AddMembersModal({ open, onClose, chatId, exclude }: { open: boolean; onClose: () => void; chatId: string; exclude: string[] }) {
  const { t } = useI18n()
  const add = useAddChatMembers()
  const [picked, setPicked] = useState<string[]>([])
  return (
    <Modal
      open={open}
      onClose={() => (setPicked([]), onClose())}
      title={t('msg.addMembers')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!picked.length}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { chatId, members: picked },
                {
                  onSuccess: () => {
                    setPicked([])
                    onClose()
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
            data-testid="add-members-confirm"
          >
            {t('msg.add')}
          </Button>
        </>
      }
    >
      <PeoplePicker picked={picked} onChange={setPicked} exclude={exclude} />
    </Modal>
  )
}

/* ---------- Медиа, файлы, голосовые, ссылки ---------- */

function MediaGrid({ chatId, onOpen }: { chatId: string; onOpen: (items: ChatAttachment[], index: number) => void }) {
  const { t } = useI18n()
  const media = useChatMedia(chatId, ['image', 'video'])
  if (media.isLoading) return <Skeleton className="h-40" />
  const items = media.data ?? []
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">{t('msg.noMedia')}</p>
  return (
    <div className="grid grid-cols-3 gap-1">
      {items.map((a, i) => (
        <button key={a.id} type="button" onClick={() => onOpen(items, i)} className="relative aspect-square overflow-hidden rounded-lg bg-canvas">
          {a.thumb && <img src={a.thumb} alt={a.name} className="h-full w-full object-cover transition hover:scale-105" />}
          {a.kind === 'video' && (
            <span className="absolute right-1 bottom-1 grid h-5 w-5 place-items-center rounded-full bg-ink/60 text-white">
              <Play className="ml-px h-2.5 w-2.5 fill-current" />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function AttachmentList({ chatId, kind }: { chatId: string; kind: 'file' | 'voice' }) {
  const { t } = useI18n()
  const list = useChatMedia(chatId, [kind])
  if (list.isLoading) return <Skeleton className="h-24" />
  const items = list.data ?? []
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">{kind === 'file' ? t('msg.noFiles') : t('msg.noVoice')}</p>
  return (
    <ul className="space-y-1">
      {items.map((a) => (
        <li key={a.id} className="rounded-xl px-1">
          {kind === 'file' ? <FileCard a={a} /> : <VoicePlayer a={a} />}
          <div className="pl-1 text-[11px] text-muted">{fmtDate(a.created_at, 'd MMMM yyyy')}</div>
        </li>
      ))}
    </ul>
  )
}

function LinksList({ messages }: { messages: ChatMessage[] }) {
  const { t } = useI18n()
  const links = useMemo(() => {
    const out: { url: string; at: string }[] = []
    for (const m of [...messages].reverse()) for (const url of extractLinks(m.body)) if (!out.some((x) => x.url === url)) out.push({ url, at: m.created_at })
    return out
  }, [messages])
  if (!links.length) return <p className="py-8 text-center text-sm text-muted">{t('msg.noLinks')}</p>
  return (
    <ul className="space-y-1">
      {links.map((l) => (
        <li key={l.url}>
          <a
            href={l.url.startsWith('www.') ? `https://${l.url}` : l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-canvas"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700">
              <ExternalLink className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-brand-700">{l.url.replace(/^https?:\/\//, '')}</span>
              <span className="text-[11px] text-muted">{fmtDate(l.at, 'd MMMM yyyy')}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
