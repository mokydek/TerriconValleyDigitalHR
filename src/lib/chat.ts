import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { must, realtimeEnabled, supabase } from './supabase'
import { useAuth } from './auth'
import type { ChatInfo, ChatKind, ChatListItem, ChatMember, ChatMessage, PollState, ReactionKey } from './types'

/** Вложение, которое уходит в send_message: файл data URL и описание */
export interface OutgoingAttachment {
  kind: 'image' | 'video' | 'file' | 'voice' | 'contact'
  name: string
  mime: string
  size: number
  data?: string
  thumb?: string | null
  width?: number | null
  height?: number | null
  duration?: number | null
  waveform?: number[] | null
  contact_id?: string | null
}

export const MESSAGE_SELECT =
  'id,chat_id,author_id,body,kind,meta,reply_to,edited_at,deleted_at,forward_author_id,forward_chat_title,created_at,' +
  'attachments:chat_attachments(id,kind,name,mime,size,thumb,width,height,duration,waveform,contact_id,position),' +
  'reactions:chat_reactions(employee_id,reaction),' +
  'poll:chat_polls(question,options,multiple,anonymous,closed_at)'

const refreshChats = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: ['chats'] })
const refreshChat = (qc: QueryClient, chatId: string) => {
  void qc.invalidateQueries({ queryKey: ['chat-messages', chatId] })
  void qc.invalidateQueries({ queryKey: ['chat-info', chatId] })
  void qc.invalidateQueries({ queryKey: ['chat-members', chatId] })
  void qc.invalidateQueries({ queryKey: ['chat-media', chatId] })
  refreshChats(qc)
}

/* ---------- Чтение ---------- */

/** Чаты пользователя: закреплённые сверху, затем по последнему сообщению */
export function useChats() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['chats'],
    queryFn: () => must(supabase.rpc('chat_list')) as Promise<ChatListItem[]>,
    enabled: Boolean(me),
    // без Realtime (Docker-стек) новые сообщения подтягиваются опросом
    refetchInterval: realtimeEnabled ? 30_000 : 10_000,
  })
}

/** Непрочитанные для значка в меню: чаты «без звука» не считаются, как в Telegram */
export function useChatUnread(): number {
  const { data } = useChats()
  return (data ?? []).reduce((sum, c) => sum + (c.muted ? 0 : c.unread), 0)
}

/** Последние 300 сообщений чата по времени, с вложениями (без самих файлов), реакциями и опросами */
export function useChatMessages(chatId?: string | null) {
  return useQuery({
    queryKey: ['chat-messages', chatId],
    queryFn: async () => {
      const rows = (await must(
        supabase.from('chat_messages').select(MESSAGE_SELECT).eq('chat_id', chatId!).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
      )) as unknown as ChatMessage[]
      return rows.reverse().map((m) => ({ ...m, attachments: [...(m.attachments ?? [])].sort((a, b) => a.position - b.position) }))
    },
    enabled: Boolean(chatId),
    refetchInterval: realtimeEnabled ? 30_000 : 4_000,
  })
}

export function useChatMembers(chatId?: string | null) {
  return useQuery({
    queryKey: ['chat-members', chatId],
    queryFn: () =>
      must(
        supabase
          .from('chat_members')
          .select('employee_id,last_read_at,joined_at,role,employee:employees!chat_members_employee_fk(id,first_name,last_name,position)')
          .eq('chat_id', chatId!),
      ) as unknown as Promise<ChatMember[]>,
    enabled: Boolean(chatId),
    // время прочтения нужно для галочек «прочитано»
    refetchInterval: realtimeEnabled ? 60_000 : 8_000,
  })
}

export function useChatInfo(chatId?: string | null) {
  return useQuery({
    queryKey: ['chat-info', chatId],
    queryFn: () =>
      must(
        supabase.from('chats').select('id,kind,title,description,avatar,pinned_message_id,created_by,created_at').eq('id', chatId!).maybeSingle(),
      ) as Promise<ChatInfo | null>,
    enabled: Boolean(chatId),
    refetchInterval: realtimeEnabled ? 60_000 : 10_000,
  })
}

/** Сам файл вложения: грузится, когда его открывают, и дальше берётся из кэша */
export function useAttachmentData(id?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['chat-attachment', id],
    queryFn: async () => {
      const row = (await must(supabase.from('chat_attachments').select('data').eq('id', id!).single())) as { data: string | null }
      return row.data
    },
    enabled: Boolean(id) && enabled,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  })
}

export async function fetchAttachmentData(qc: QueryClient, id: string): Promise<string | null> {
  return qc.fetchQuery({
    queryKey: ['chat-attachment', id],
    queryFn: async () => ((await must(supabase.from('chat_attachments').select('data').eq('id', id).single())) as { data: string | null }).data,
    staleTime: Infinity,
  })
}

/** Медиа, файлы и голосовые чата для вкладок в информации о чате */
export function useChatMedia(chatId: string | null | undefined, kinds: string[], enabled = true) {
  return useQuery({
    queryKey: ['chat-media', chatId, kinds.join(',')],
    queryFn: () =>
      must(
        supabase
          .from('chat_attachments')
          .select('id,message_id,kind,name,mime,size,thumb,width,height,duration,waveform,contact_id,position,created_at')
          .eq('chat_id', chatId!)
          .in('kind', kinds)
          .order('created_at', { ascending: false })
          .limit(120),
      ) as unknown as Promise<(ChatMessage['attachments'][number] & { message_id: string; created_at: string })[]>,
    enabled: Boolean(chatId) && enabled,
  })
}

/** Итоги опросов на экране */
export function usePollState(messageIds: string[]) {
  const key = [...messageIds].sort().join(',')
  return useQuery({
    queryKey: ['poll-state', key],
    queryFn: () => must(supabase.rpc('chat_poll_state', { p_messages: messageIds })) as Promise<PollState[]>,
    enabled: messageIds.length > 0,
    refetchInterval: realtimeEnabled ? 30_000 : 6_000,
  })
}

/* ---------- Сообщения ---------- */

export function useSendMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { chatId: string; body: string; replyTo?: string | null; attachments?: OutgoingAttachment[]; mentions?: string[] }) => {
      const msg = (await must(
        supabase.rpc('send_message', {
          p_chat: v.chatId,
          p_body: v.body,
          p_reply_to: v.replyTo ?? null,
          p_attachments: v.attachments ?? [],
          p_mentions: v.mentions?.length ? v.mentions : null,
        }),
      )) as ChatMessage
      return { msg, hasFiles: Boolean(v.attachments?.length) }
    },
    onSuccess: ({ msg, hasFiles }) => {
      // текст показываем сразу; сообщение с файлами перечитываем, чтобы получить вложения
      if (!hasFiles) {
        qc.setQueryData<ChatMessage[]>(['chat-messages', msg.chat_id], (old) =>
          old && !old.some((m) => m.id === msg.id) ? [...old, { ...msg, attachments: [], reactions: [], poll: null }] : old,
        )
      }
      void qc.invalidateQueries({ queryKey: ['chat-messages', msg.chat_id] })
      if (hasFiles) void qc.invalidateQueries({ queryKey: ['chat-media', msg.chat_id] })
      refreshChats(qc)
    },
  })
}

export function useEditMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; body: string }) => must(supabase.rpc('edit_message', { p_message: v.id, p_body: v.body })) as Promise<ChatMessage>,
    onSuccess: (msg) => {
      qc.setQueryData<ChatMessage[]>(['chat-messages', msg.chat_id], (old) => old?.map((m) => (m.id === msg.id ? { ...m, body: msg.body, edited_at: msg.edited_at } : m)))
      refreshChats(qc)
    },
  })
}

export function useDeleteMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; chatId: string }) => must(supabase.rpc('delete_message', { p_message: v.id })),
    onMutate: (v) => {
      qc.setQueryData<ChatMessage[]>(['chat-messages', v.chatId], (old) => old?.filter((m) => m.id !== v.id))
    },
    onSettled: (_d, _e, v) => refreshChat(qc, v.chatId),
  })
}

/** Реакция: показываем сразу, сервер подтверждает (одна реакция на человека) */
export function useToggleReaction() {
  const qc = useQueryClient()
  const { me } = useAuth()
  return useMutation({
    mutationFn: (v: { id: string; chatId: string; reaction: ReactionKey }) => must(supabase.rpc('toggle_reaction', { p_message: v.id, p_reaction: v.reaction })),
    onMutate: (v) => {
      if (!me) return
      qc.setQueryData<ChatMessage[]>(['chat-messages', v.chatId], (old) =>
        old?.map((m) => {
          if (m.id !== v.id) return m
          const mine = m.reactions.find((r) => r.employee_id === me.id)
          const others = m.reactions.filter((r) => r.employee_id !== me.id)
          return { ...m, reactions: mine?.reaction === v.reaction ? others : [...others, { employee_id: me.id, reaction: v.reaction }] }
        }),
      )
    },
    onSettled: (_d, _e, v) => void qc.invalidateQueries({ queryKey: ['chat-messages', v.chatId] }),
  })
}

export function useForwardMessages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ids: string[]; to: string; comment?: string }) =>
      must(supabase.rpc('forward_messages', { p_messages: v.ids, p_to: v.to, p_comment: v.comment || null })) as Promise<number>,
    onSuccess: (_n, v) => refreshChat(qc, v.to),
  })
}

export function usePinMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; id: string | null }) => must(supabase.rpc('pin_message', { p_chat: v.chatId, p_message: v.id })),
    onSuccess: (_d, v) => refreshChat(qc, v.chatId),
  })
}

export function useMarkChatRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (chatId: string) => must(supabase.rpc('mark_chat_read', { p_chat: chatId })),
    onSuccess: () => refreshChats(qc),
  })
}

/* ---------- Опросы ---------- */

export function useCreatePoll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; question: string; options: string[]; multiple: boolean; anonymous: boolean }) =>
      must(
        supabase.rpc('create_poll', { p_chat: v.chatId, p_question: v.question, p_options: v.options, p_multiple: v.multiple, p_anonymous: v.anonymous }),
      ),
    onSuccess: (_d, v) => refreshChat(qc, v.chatId),
  })
}

export function useVotePoll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; options: number[] }) => must(supabase.rpc('vote_poll', { p_message: v.id, p_options: v.options })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['poll-state'] }),
  })
}

export function useClosePoll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; chatId: string }) => must(supabase.rpc('close_poll', { p_message: v.id })),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['poll-state'] })
      void qc.invalidateQueries({ queryKey: ['chat-messages', v.chatId] })
    },
  })
}

/* ---------- Чаты, группы, каналы ---------- */

export function useOpenDirectChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (employeeId: string) => must(supabase.rpc('open_direct_chat', { p_employee: employeeId })) as Promise<string>,
    onSuccess: () => refreshChats(qc),
  })
}

export function useOpenSavedChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => must(supabase.rpc('open_saved_chat')) as Promise<string>,
    onSuccess: () => refreshChats(qc),
  })
}

export function useCreateGroupChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { title: string; members: string[]; kind?: Extract<ChatKind, 'group' | 'channel'>; description?: string; avatar?: string | null }) =>
      must(
        supabase.rpc('create_group_chat', {
          p_title: v.title,
          p_members: v.members,
          p_kind: v.kind ?? 'group',
          p_description: v.description || null,
          p_avatar: v.avatar ?? null,
        }),
      ) as Promise<string>,
    onSuccess: () => refreshChats(qc),
  })
}

export function useUpdateChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; title?: string; description?: string; avatar?: string | null; clearAvatar?: boolean }) =>
      must(
        supabase.rpc('update_chat', {
          p_chat: v.chatId,
          p_title: v.title ?? null,
          p_description: v.description ?? null,
          p_avatar: v.avatar ?? null,
          p_clear_avatar: Boolean(v.clearAvatar),
        }),
      ),
    onSuccess: (_d, v) => refreshChat(qc, v.chatId),
  })
}

export function useAddChatMembers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; members: string[] }) => must(supabase.rpc('add_chat_members', { p_chat: v.chatId, p_members: v.members })) as Promise<number>,
    onSuccess: (_d, v) => refreshChat(qc, v.chatId),
  })
}

export function useRemoveChatMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; member: string }) => must(supabase.rpc('remove_chat_member', { p_chat: v.chatId, p_member: v.member })),
    onSuccess: (_d, v) => refreshChat(qc, v.chatId),
  })
}

export function useSetChatMemberRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; member: string; role: 'admin' | 'member' }) =>
      must(supabase.rpc('set_chat_member_role', { p_chat: v.chatId, p_member: v.member, p_role: v.role })),
    onSuccess: (_d, v) => refreshChat(qc, v.chatId),
  })
}

export function useLeaveChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (chatId: string) => must(supabase.rpc('leave_chat', { p_chat: chatId })),
    onSuccess: () => refreshChats(qc),
  })
}

/** «Без звука» и закреп чата в списке: меняем сразу, сервер подтверждает */
export function useSetChatPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; muted?: boolean; pinned?: boolean }) =>
      must(supabase.rpc('set_chat_prefs', { p_chat: v.chatId, p_muted: v.muted ?? null, p_pinned: v.pinned ?? null })),
    onMutate: (v) => {
      qc.setQueryData<ChatListItem[]>(['chats'], (old) =>
        old?.map((c) => (c.id === v.chatId ? { ...c, muted: v.muted ?? c.muted, pinned: v.pinned ?? c.pinned } : c)),
      )
    },
    onSettled: () => refreshChats(qc),
  })
}

/* ---------- Realtime ---------- */

/** Новые сообщения, правки, реакции, голоса и прочтения в чатах пользователя приходят сразу */
export function useRealtimeChats() {
  const { me } = useAuth()
  const qc = useQueryClient()
  useEffect(() => {
    if (!me || !realtimeEnabled) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    const onChange = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown>; table?: string }) => {
      const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) ?? {}
      const chatId = (row.chat_id ?? (payload.table === 'chats' ? row.id : undefined)) as string | undefined
      if (chatId) refreshChat(qc, chatId)
      else {
        void qc.invalidateQueries({ queryKey: ['chat-messages'] })
        refreshChats(qc)
      }
      if (payload.table === 'chat_poll_votes') void qc.invalidateQueries({ queryKey: ['poll-state'] })
    }
    try {
      channel = supabase.channel(`chat-${me.id}-${Math.random().toString(36).slice(2, 10)}`)
      for (const table of ['chat_messages', 'chat_reactions', 'chat_poll_votes', 'chat_members', 'chats']) {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => onChange({ ...p, table }))
      }
      channel.subscribe()
    } catch (error) {
      console.warn('Realtime unavailable', error)
    }
    return () => {
      if (channel) void supabase.removeChannel(channel)
    }
  }, [me, qc])
}

/** «Печатает…»: короткие сигналы через Realtime, в базу ничего не пишется */
export function useTyping(chatId: string) {
  const { me } = useAuth()
  const [typing, setTyping] = useState<string[]>([])
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const lastSent = useRef(0)
  const timers = useRef(new Map<string, number>())

  useEffect(() => {
    if (!me || !realtimeEnabled) return
    const ch = supabase.channel(`typing:${chatId}`, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const who = (payload as { id?: string })?.id
      if (!who || who === me.id) return
      setTyping((cur) => (cur.includes(who) ? cur : [...cur, who]))
      window.clearTimeout(timers.current.get(who))
      timers.current.set(
        who,
        window.setTimeout(() => setTyping((cur) => cur.filter((x) => x !== who)), 4500),
      )
    })
    ch.subscribe()
    channel.current = ch
    const pending = timers.current
    return () => {
      for (const t of pending.values()) window.clearTimeout(t)
      pending.clear()
      channel.current = null
      void supabase.removeChannel(ch)
    }
  }, [chatId, me])

  const notify = useCallback(() => {
    if (!me || !channel.current) return
    const now = Date.now()
    if (now - lastSent.current < 2500) return
    lastSent.current = now
    void channel.current.send({ type: 'broadcast', event: 'typing', payload: { id: me.id } })
  }, [me])

  return { typing, notify }
}
