import { PageHeader } from '@/components/ui'
import { PeopleTable } from '@/components/hr/PeopleTable'

export default function EmployeesPage() {
  return (
    <div>
      <PageHeader
        title="Сотрудники"
        subtitle="⭐ «Слежу» включает уведомления по сотруднику"
      />
      <PeopleTable canFollow />
    </div>
  )
}
