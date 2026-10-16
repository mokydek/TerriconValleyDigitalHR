import { PageHeader } from '@/components/ui'
import { PeopleTable } from '@/components/hr/PeopleTable'

export default function EmployeesPage() {
  return (
    <div>
      <PageHeader
        title="Сотрудники"
        subtitle="Вся компания: поиск, фильтры и звёздочка «Слежу» — человек попадает в ваш список наблюдения, а вы получаете уведомления о его заявках, курсах и просрочках"
      />
      <PeopleTable canFollow />
    </div>
  )
}
