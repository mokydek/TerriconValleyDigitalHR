import { useI18n } from '@/lib/i18n'
import { PageHeader } from '@/components/ui'
import { PeopleTable } from '@/components/hr/PeopleTable'

export default function EmployeesPage() {
  const { t } = useI18n()
  return (
    <div>
      <PageHeader
        title={t('nav.employees')}
        subtitle={t('employees.subtitle')}
      />
      <PeopleTable canFollow />
    </div>
  )
}
