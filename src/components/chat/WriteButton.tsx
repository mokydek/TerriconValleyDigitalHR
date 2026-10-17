import { useNavigate } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { useOpenDirectChat } from '@/lib/chat'
import { Button } from '@/components/ui'

/** «Написать»: открывает личный чат с сотрудником (существующий или новый) */
export function WriteButton({ employeeId, size = 'md' }: { employeeId: string; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const open = useOpenDirectChat()
  return (
    <Button
      variant="outline"
      size={size}
      icon={<MessageCircle className="h-4 w-4" />}
      loading={open.isPending}
      onClick={() =>
        open.mutate(employeeId, {
          onSuccess: (chatId) => navigate(`/messages?chat=${chatId}`),
          onError: (e) => toast.error((e as Error).message),
        })
      }
      data-testid="write-button"
    >
      {t('chat.write')}
    </Button>
  )
}
