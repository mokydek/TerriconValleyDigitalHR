import { useI18n } from '@/lib/i18n'
import { PageHeader } from '@/components/ui'
import { PeopleTable } from '@/components/hr/PeopleTable'

export default function TeamPage() {
  const { t } = useI18n()
  return (
    <div>
      <PageHeader
        title={t('nav.team')}
        subtitle={t('team.subtitle')}
      />
      <PeopleTable canFollow={false} />
    </div>
  )
}
