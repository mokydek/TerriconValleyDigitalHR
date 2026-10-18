import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  Bell,
  BellOff,
  ContactRound,
  CornerUpLeft,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  SendHorizontal,
  Trash2,
  X,
} from '@/components/icons'
import { useI18n } from '@/lib/i18n'
import { useEmployeesLite } from '@/lib/api'
import { fullName } from '@/lib/format'
import { useCreatePoll, useEditMessage, useSendMessage, useSetChatPrefs, type OutgoingAttachment } from '@/lib/chat'
import { MAX_ATTACHMENTS, fileBadge, fmtDuration, mentionedIds, prepareChatFile, useVoiceRecorder } from '@/lib/chatMedia'
import { fileSize } from '@/lib/files'
import { cn } from '@/lib/utils'
import { Avatar, Button, Field, Modal } from '@/components/ui'
import type { ChatKind, ChatMessage } from '@/lib/types'
import { PeoplePicker } from './PeoplePicker'
import { FloatingMenu, MenuButton } from './shared'
import { quotePreview } from './MessageBubble'

export interface ComposerHandle {
  addFiles: (files: File[]) => void
  focus: () => void
}

const draftKey = (chatId: string) => `janamen-draft:${chatId}`
const readDraft = (chatId: string) => {
  try {
    return localStorage.getItem(draftKey(chatId)) ?? ''
  } catch {
    return ''
  }
}
const writeDraft = (chatId: string, text: string) => {
  try {
    if (text.trim()) localStorage.setItem(draftKey(chatId), text)
    else localStorage.removeItem(draftKey(chatId))
  } catch {
    /* хранилище недоступно */
  }
}

type Pending = OutgoingAttachment & { key: string }

export const Composer = forwardRef<
  ComposerHandle,
  {
    chatId: string
    chatKind: ChatKind
    canPost: boolean
    muted: boolean
    people: { id: string; name: string }[]
    nameOf: (id: string) => string
    replyTo: ChatMessage | null
    onCancelReply: () => void
    editing: ChatMessage | null
    onCancelEdit: () => void
    onSent: () => void
    onTyping: () => void
  }
>(function Composer({ chatId, chatKind, canPost, muted, people, nameOf, replyTo, onCancelReply, editing, onCancelEdit, onSent, onTyping }, ref) {
  const { t } = useI18n()
  const send = useSendMessage()
  const edit = useEditMessage()
  const prefs = useSetChatPrefs()
  const recorder = useVoiceRecorder()
  const [text, setText] = useState(() => readDraft(chatId))
  const [files, setFiles] = useState<Pending[]>([])
  const [preparing, setPreparing] = useState(0)
  const [attachMenu, setAttachMenu] = useState<{ x: number; y: number } | null>(null)
  const [pollOpen, setPollOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const draftBeforeEdit = useRef('')
  const photoInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const group = chatKind === 'group' || chatKind === 'channel'

  // черновик сохраняется для каждого чата, как в Telegram
  useEffect(() => {
    if (editing) return
    const id = window.setTimeout(() => writeDraft(chatId, text), 300)
    return () => window.clearTimeout(id)
  }, [chatId, text, editing])

  // правка: в поле подставляется текст сообщения
  const editingId = editing?.id
  useEffect(() => {
    if (!editing) return
    draftBeforeEdit.current = text
    setText(editing.body)
    window.setTimeout(() => {
      area.current?.focus()
      area.current?.setSelectionRange(editing.body.length, editing.body.length)
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const addFiles = async (list: File[]) => {
    if (!list.length) return
    const room = MAX_ATTACHMENTS - files.length
    if (room <= 0) return toast.error(t('msg.tooManyFiles', { n: MAX_ATTACHMENTS }))
    const take = list.slice(0, room)
    if (list.length > room) toast.error(t('msg.tooManyFiles', { n: MAX_ATTACHMENTS }))
    setPreparing((n) => n + take.length)
    for (const f of take) {
      try {
        const a = await prepareChatFile(f)
        setFiles((cur) => [...cur, { ...a, key: `${Date.now()}-${Math.random()}` }])
      } catch (e) {
        toast.error((e as Error).message === 'too-big' ? t('msg.fileTooBig', { name: f.name }) : t('msg.fileFailed', { name: f.name }))
      } finally {
        setPreparing((n) => n - 1)
      }
    }
    area.current?.focus()
  }

  useImperativeHandle(ref, () => ({ addFiles: (l) => void addFiles(l), focus: () => area.current?.focus() }))

  // упоминание: «@» и начало имени перед курсором
  const before = text.slice(0, caret)
  const mentionMatch = group && !editing ? /(?:^|\s)@([^\s@]{0,30})$/.exec(before) : null
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? null
  const mentionList = mentionQuery === null ? [] : people.filter((p) => p.name.toLowerCase().includes(mentionQuery)).slice(0, 6)
  const pickMention = (p: { id: string; name: string }) => {
    if (!mentionMatch) return
    const start = caret - mentionMatch[1].length - 1
    const next = text.slice(0, start) + '@' + p.name + ' ' + text.slice(caret)
    setText(next)
    const pos = start + p.name.length + 2
    window.setTimeout(() => {
      area.current?.focus()
      area.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    }, 0)
  }

  const busy = send.isPending || edit.isPending
  const canSend = Boolean(text.trim()) || files.length > 0

  const submit = () => {
    if (busy || preparing) return
    const body = text.trim()
    if (editing) {
      if (!body && !editing.attachments.length) return
      edit.mutate(
        { id: editing.id, body },
        {
          onSuccess: () => {
            setText(draftBeforeEdit.current)
            onCancelEdit()
          },
          onError: (e) => toast.error((e as Error).message),
        },
      )
      return
    }
    if (!canSend) return
    const outgoing = files.map(({ key: _k, ...a }) => a)
    const reply = replyTo
    setText('')
    setFiles([])
    writeDraft(chatId, '')
    onCancelReply()
    onSent()
    send.mutate(
      { chatId, body, replyTo: reply?.id, attachments: outgoing, mentions: mentionedIds(body, people) },
      {
        onError: (e) => {
          setText(body)
          setFiles(outgoing.map((a) => ({ ...a, key: `${Date.now()}-${Math.random()}` })))
          toast.error((e as Error).message)
        },
      },
    )
  }

  const sendVoice = async () => {
    const voice = await recorder.stop()
    if (!voice) return
    onSent()
    send.mutate({ chatId, body: '', replyTo: replyTo?.id, attachments: [voice] }, { onError: (e) => toast.error((e as Error).message) })
    onCancelReply()
  }

  if (!canPost)
    return (
      <footer className="flex items-center justify-center gap-3 border-t border-line bg-white px-4 py-3 text-sm text-muted" data-testid="channel-readonly">
        <span>{t('msg.channelReadonly')}</span>
        <Button
          size="sm"
          variant="soft"
          icon={muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          onClick={() => prefs.mutate({ chatId, muted: !muted })}
        >
          {muted ? t('msg.unmute') : t('msg.mute')}
        </Button>
      </footer>
    )

  return (
    <footer className="relative border-t border-line bg-white px-3 py-3 sm:px-4">
      {/* Подсказка упоминаний */}
      {mentionList.length > 0 && (
        <ul className="absolute right-3 bottom-full left-3 z-20 mb-2 animate-pop overflow-hidden rounded-2xl border border-line bg-white p-1 shadow-[var(--shadow-pop)] sm:right-auto sm:w-80" role="listbox" data-testid="mention-list">
          {mentionList.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => (e.preventDefault(), pickMention(p))}
                className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm', i === mentionIndex ? 'bg-brand-50' : 'hover:bg-canvas')}
              >
                <Avatar id={p.id} name={p.name} size={28} />
                <span className="truncate font-medium">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(replyTo || editing) && (
        <div className="mb-2 flex items-start gap-2 rounded-xl bg-canvas px-3 py-2" data-testid={editing ? 'chat-edit-preview' : 'chat-reply-preview'}>
          {editing ? <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />}
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-brand-700">{editing ? t('msg.editing') : `${t('chat.replying')} · ${nameOf(replyTo!.author_id)}`}</div>
            <div className="truncate text-muted">{quotePreview((editing ?? replyTo)!, t)}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (editing) {
                setText(draftBeforeEdit.current)
                onCancelEdit()
              } else onCancelReply()
            }}
            className="rounded-lg p-1 text-muted hover:bg-white hover:text-ink"
            aria-label={t('common.cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {(files.length > 0 || preparing > 0) && (
        <div className="scrollbar-thin mb-2 flex gap-2 overflow-x-auto pb-1" data-testid="chat-pending">
          {files.map((f) => (
            <div key={f.key} className="relative shrink-0 animate-pop">
              {(f.kind === 'image' || f.kind === 'video') && f.thumb ? (
                <img src={f.thumb} alt={f.name} className="h-16 w-16 rounded-xl object-cover ring-1 ring-line" />
              ) : (
                <div className="flex h-16 w-40 items-center gap-2 rounded-xl bg-canvas px-2 ring-1 ring-line">
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[9px] font-bold text-white', fileBadge(f.name, f.mime).tone)}>
                    {fileBadge(f.name, f.mime).label}
                  </span>
                  <span className="min-w-0 text-xs">
                    <span className="block truncate font-medium">{f.name}</span>
                    <span className="text-muted">{fileSize(f.size)}</span>
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setFiles((cur) => cur.filter((x) => x.key !== f.key))}
                className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-white shadow ring-2 ring-white"
                aria-label={t('common.delete')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {preparing > 0 && (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-canvas ring-1 ring-line">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            </div>
          )}
        </div>
      )}

      {recorder.state === 'recording' ? (
        <div className="flex items-center gap-2" data-testid="voice-recording">
          <button
            type="button"
            onClick={recorder.cancel}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-rose-600 hover:bg-rose-50"
            aria-label={t('msg.voiceCancel')}
            title={t('msg.voiceCancel')}
          >
            <Trash2 className="h-5 w-5" />
          </button>
          <div className="flex h-11 flex-1 items-center gap-3 rounded-xl bg-rose-50 px-3">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
            <span className="font-medium text-rose-700 tabular-nums">{fmtDuration(recorder.seconds)}</span>
            <span className="flex h-6 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
              {Array.from({ length: 28 }, (_, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-rose-400 transition-[height] duration-100"
                  style={{ height: `${Math.max(12, Math.min(100, recorder.level * 100 * (0.5 + 0.5 * Math.abs(Math.sin(i + recorder.seconds)))))}%` }}
                />
              ))}
            </span>
            <span className="hidden text-xs text-rose-600/80 sm:inline">{t('msg.voiceRecording')}</span>
          </div>
          <Button size="icon" className="h-11 w-11" icon={<SendHorizontal className="h-5 w-5" />} onClick={() => void sendVoice()} aria-label={t('chat.send')} data-testid="voice-send" />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex items-end gap-2"
        >
          {!editing && (
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setAttachMenu({ x: r.left, y: r.top - 8 - (group ? 196 : 152) })
              }}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-canvas hover:text-brand-700 active:scale-95"
              aria-label={t('msg.attach')}
              title={t('msg.attach')}
              data-testid="chat-attach"
            >
              <Paperclip className="h-5 w-5" />
            </button>
          )}
          <textarea
            ref={area}
            rows={1}
            value={text}
            maxLength={4000}
            onChange={(e) => {
              setText(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              setMentionIndex(0)
              onTyping()
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (mentionList.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : mentionList.length - 1)) % mentionList.length)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  pickMention(mentionList[mentionIndex] ?? mentionList[0])
                  return
                }
              }
              if (e.key === 'Escape' && (editing || replyTo)) {
                if (editing) {
                  setText(draftBeforeEdit.current)
                  onCancelEdit()
                } else onCancelReply()
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files]
              if (pasted.length) {
                e.preventDefault()
                void addFiles(pasted)
              }
            }}
            placeholder={files.length ? t('msg.caption') : t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            className="field max-h-[160px] min-h-[44px] flex-1 resize-none"
            data-testid="chat-input"
          />
          {canSend || editing || recorder.state === 'unsupported' ? (
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11"
              icon={<SendHorizontal className="h-5 w-5" />}
              loading={busy || preparing > 0}
              disabled={!canSend && !editing}
              aria-label={editing ? t('common.save') : t('chat.send')}
              title={editing ? t('common.save') : t('chat.send')}
              data-testid="chat-send"
            />
          ) : (
            <Button
              type="button"
              size="icon"
              variant="soft"
              className="h-11 w-11"
              icon={<Mic className="h-5 w-5" />}
              onClick={() => {
                if (recorder.state === 'denied') toast.error(t('msg.micDenied'))
                void recorder.start()
              }}
              aria-label={t('msg.voiceRecord')}
              title={t('msg.voiceRecord')}
              data-testid="voice-record"
            />
          )}
        </form>
      )}
      <p className="mt-1.5 hidden text-[11px] text-muted sm:block">{t('msg.sendHint')}</p>

      <input
        ref={photoInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
        data-testid="chat-photo-input"
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
        data-testid="chat-file-input"
      />

      {attachMenu && (
        <FloatingMenu at={attachMenu} onClose={() => setAttachMenu(null)} width={230}>
          <MenuButton icon={<ImageIcon className="h-4 w-4 text-sky-600" />} onClick={() => (setAttachMenu(null), photoInput.current?.click())} testId="attach-photo">
            {t('msg.attachPhoto')}
          </MenuButton>
          <MenuButton icon={<FileText className="h-4 w-4 text-violet-600" />} onClick={() => (setAttachMenu(null), fileInput.current?.click())} testId="attach-file">
            {t('msg.attachFile')}
          </MenuButton>
          {group && (
            <MenuButton icon={<BarChart3 className="h-4 w-4 text-amber-600" />} onClick={() => (setAttachMenu(null), setPollOpen(true))} testId="attach-poll">
              {t('msg.attachPoll')}
            </MenuButton>
          )}
          <MenuButton icon={<ContactRound className="h-4 w-4 text-brand-600" />} onClick={() => (setAttachMenu(null), setContactOpen(true))} testId="attach-contact">
            {t('msg.attachContact')}
          </MenuButton>
        </FloatingMenu>
      )}
      <PollModal open={pollOpen} onClose={() => setPollOpen(false)} chatId={chatId} onSent={onSent} />
      <ContactModal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        onPick={(id, name) => {
          setContactOpen(false)
          onSent()
          send.mutate(
            { chatId, body: '', attachments: [{ kind: 'contact', name, mime: '', size: 0, contact_id: id }] },
            { onError: (e) => toast.error((e as Error).message) },
          )
        }}
      />
    </footer>
  )
})

/* ---------- Опрос ---------- */

function PollModal({ open, onClose, chatId, onSent }: { open: boolean; onClose: () => void; chatId: string; onSent: () => void }) {
  const { t } = useI18n()
  const create = useCreatePoll()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [anonymous, setAnonymous] = useState(true)
  const [multiple, setMultiple] = useState(false)
  useEffect(() => {
    if (!open) return
    setQuestion('')
    setOptions(['', ''])
    setAnonymous(true)
    setMultiple(false)
  }, [open])
  const filled = options.map((o) => o.trim()).filter(Boolean)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('msg.pollNew')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!question.trim() || filled.length < 2}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { chatId, question: question.trim(), options: filled, anonymous, multiple },
                {
                  onSuccess: () => {
                    onSent()
                    onClose()
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
            data-testid="poll-create"
          >
            {t('msg.pollCreate')}
          </Button>
        </>
      }
    >
      <Field label={t('msg.pollQuestion')}>
        <input className="field" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder={t('msg.pollQuestionHint')} data-testid="poll-question" />
      </Field>
      <div className="mt-4">
        <span className="label">{t('msg.pollOptions')}</span>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="field"
                value={o}
                maxLength={100}
                onChange={(e) => setOptions((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={t('msg.pollOption', { n: i + 1 })}
                data-testid="poll-option-input"
              />
              {options.length > 2 && (
                <button type="button" onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-rose-600" aria-label={t('common.delete')}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < 10 && (
          <button type="button" onClick={() => setOptions((cur) => [...cur, ''])} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline" data-testid="poll-add-option">
            <Plus className="h-4 w-4" /> {t('msg.pollAddOption')}
          </button>
        )}
      </div>
      <div className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          {t('msg.pollAnonymousOpt')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
          {t('msg.pollMultipleOpt')}
        </label>
      </div>
    </Modal>
  )
}

/* ---------- Контакт коллеги ---------- */

function ContactModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string, name: string) => void }) {
  const { t } = useI18n()
  const people = useEmployeesLite()
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (open) setPicked([])
  }, [open])
  const person = (people.data ?? []).find((p) => p.id === picked[0])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('msg.contactPick')}
      subtitle={t('msg.contactHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!person} onClick={() => person && onPick(person.id, fullName(person))} data-testid="contact-send">
            {t('chat.send')}
          </Button>
        </>
      }
    >
      <PeoplePicker picked={picked} onChange={setPicked} single />
    </Modal>
  )
}
