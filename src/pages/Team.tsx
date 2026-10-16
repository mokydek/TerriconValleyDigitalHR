import { PageHeader } from '@/components/ui'
import { PeopleTable } from '@/components/hr/PeopleTable'

export default function TeamPage() {
  return (
    <div>
      <PageHeader
        title="Моя команда"
        subtitle="Только ваши сотрудники (прямые и через руководителей ниже). Зарплаты и персональные данные руководителю недоступны."
      />
      <PeopleTable canFollow={false} />
    </div>
  )
}
