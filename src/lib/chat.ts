import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { must, realtimeEnabled, supabase } from './supabase'
import { useAuth } from './auth'
import type { ChatListItem, ChatMember, ChatMessage } from './types'

/** Чаты пользователя с последним сообщением и числом непрочитанных */
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

export function useChatUnread(): number {
  const { data } = useChats()
  return (data ?? []).reduce((sum, c) => sum + c.unread, 0)
}

/** Последние 500 сообщений чата, по времени */
export function useChatMessages(chatId?: string | null) {
  return useQuery({
    queryKey: ['chat-messages', chatId],
    queryFn: async () => {
      const rows = (await must(
        supabase
          .from('chat_messages')
          .select('id,chat_id,author_id,body,reply_to,created_at')
          .eq('chat_id', chatId!)
          .order('created_at', { ascending: false })
          .limit(500),
      )) as ChatMessage[]
      return rows.reverse()
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
          .select('employee_id,last_read_at,employee:employees!chat_members_employee_fk(id,first_name,last_name,position)')
          .eq('chat_id', chatId!),
      ) as unknown as Promise<ChatMember[]>,
    enabled: Boolean(chatId),
    staleTime: 60_000,
  })
}

export function useSendMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { chatId: string; body: string; replyTo?: string | null }) =>
      must(supabase.rpc('send_message', { p_chat: v.chatId, p_body: v.body, p_reply_to: v.replyTo ?? null })) as Promise<ChatMessage>,
    onSuccess: (msg) => {
      // своё сообщение показываем сразу, не дожидаясь обновления списка
      qc.setQueryData<ChatMessage[]>(['chat-messages', msg.chat_id], (old) => (old && !old.some((m) => m.id === msg.id) ? [...old, msg] : old))
      void qc.invalidateQueries({ queryKey: ['chats'] })
    },
  })
}

export function useMarkChatRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (chatId: string) => must(supabase.rpc('mark_chat_read', { p_chat: chatId })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chats'] }),
  })
}

export function useOpenDirectChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (employeeId: string) => must(supabase.rpc('open_direct_chat', { p_employee: employeeId })) as Promise<string>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chats'] }),
  })
}

export function useCreateGroupChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { title: string; members: string[] }) =>
      must(supabase.rpc('create_group_chat', { p_title: v.title, p_members: v.members })) as Promise<string>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chats'] }),
  })
}

/** Новые сообщения в чатах пользователя приходят сразу (база отдаёт только его чаты) */
export function useRealtimeChats() {
  const { me } = useAuth()
  const qc = useQueryClient()
  useEffect(() => {
    if (!me || !realtimeEnabled) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(`chat-${me.id}-${Math.random().toString(36).slice(2, 10)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
          const chatId = (payload.new as { chat_id?: string }).chat_id
          void qc.invalidateQueries({ queryKey: ['chats'] })
          if (chatId) void qc.invalidateQueries({ queryKey: ['chat-messages', chatId] })
        })
        .subscribe()
    } catch (error) {
      console.warn('Realtime недоступен', error)
    }
    return () => {
      if (channel) void supabase.removeChannel(channel)
    }
  }, [me, qc])
}
