import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import Navigation from '@/components/Navigation'
import { calcTaskStatus, FREQUENCY_LABELS, type Equipment, type MaintenanceTask, type MaintenanceLog, type Profile, type TaskStatus } from '@/lib/types'

const STATUS_ARIA: Record<TaskStatus, string> = {
  ok: 'В порядке',
  due_soon: 'Скоро истекает',
  overdue: 'Просрочено',
}

function StatusDot({ status }: { status: TaskStatus }) {
  const colors: Record<TaskStatus, string> = {
    ok: 'bg-green-500',
    due_soon: 'bg-yellow-400',
    overdue: 'bg-red-500',
  }
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${colors[status]}`}
      aria-label={STATUS_ARIA[status]}
      role="status"
      title={STATUS_ARIA[status]}
    />
  )
}

function StatusBadge({ status, count }: { status: TaskStatus; count: number }) {
  if (count === 0) return null
  const styles: Record<TaskStatus, string> = {
    ok: 'bg-green-100 text-green-800',
    due_soon: 'bg-yellow-100 text-yellow-800',
    overdue: 'bg-red-100 text-red-800',
  }
  const labels: Record<TaskStatus, string> = {
    ok: 'в порядке',
    due_soon: 'скоро',
    overdue: 'просрочено',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {count} {labels[status]}
    </span>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  // Загружаем всё оборудование
  const { data: equipment } = await supabase
    .from('equipment')
    .select('*')
    .eq('status', 'active')
    .order('sort_order')

  // Загружаем все активные задачи
  const { data: tasks } = await supabase
    .from('maintenance_tasks')
    .select('*')
    .eq('is_active', true)

  // Загружаем последний выполненный лог для каждой задачи через view.
  // View latest_done_logs использует DISTINCT ON (task_id) — возвращает
  // максимум 1 строку на задачу, обходя лимит 1000 строк Supabase (BUG-01)
  const { data: logs } = await supabase
    .from('latest_done_logs')
    .select('*')

  const equipmentList = equipment as Equipment[] || []
  const taskList = tasks as MaintenanceTask[] || []
  const logList = logs as MaintenanceLog[] || []

  // Строим карту: task_id → последний лог
  const lastLogByTask: Record<string, MaintenanceLog> = {}
  for (const log of logList) {
    if (!lastLogByTask[log.task_id]) {
      lastLogByTask[log.task_id] = log
    }
  }

  // Считаем статусы по оборудованию
  const equipmentStats = equipmentList.map(eq => {
    const eqTasks = taskList.filter(t => t.equipment_id === eq.id)
    let overdue = 0
    let dueSoon = 0

    for (const task of eqTasks) {
      const lastLog = lastLogByTask[task.id] || null
      const { status } = calcTaskStatus(task.frequency, lastLog)
      if (status === 'overdue') overdue++
      else if (status === 'due_soon') dueSoon++
    }

    const overall: TaskStatus = overdue > 0 ? 'overdue' : dueSoon > 0 ? 'due_soon' : 'ok'
    return { ...eq, overdue, dueSoon, overall, total: eqTasks.length }
  })

  const totalOverdue = equipmentStats.reduce((s, e) => s + e.overdue, 0)
  const totalDueSoon = equipmentStats.reduce((s, e) => s + e.dueSoon, 0)

  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="min-h-screen md:flex">
      <Navigation profile={profile as Profile} />
      <main className="flex-1 p-4 sm:p-6">
        {/* Заголовок */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Дашборд</h1>
          <p className="text-sm text-gray-500 mt-1 capitalize">{today}</p>
        </div>

        {/* Сводка */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Просрочено</p>
            <p className="text-3xl font-bold text-red-600">{totalOverdue}</p>
            <p className="text-xs text-gray-400 mt-1">работ требуют внимания</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Скоро истекает</p>
            <p className="text-3xl font-bold text-yellow-500">{totalDueSoon}</p>
            <p className="text-xs text-gray-400 mt-1">работ в ближайшие 3 дня</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Единиц оборудования</p>
            <p className="text-3xl font-bold text-gray-900">{equipmentList.length}</p>
            <p className="text-xs text-gray-400 mt-1">в эксплуатации</p>
          </div>
        </div>

        {/* Список оборудования */}
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Состояние оборудования</h2>
        <div className="space-y-3">
          {equipmentStats.map(eq => (
            <Link
              key={eq.id}
              href={`/equipment/${eq.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusDot status={eq.overall} />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{eq.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{eq.total} регламентных работ</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {eq.overdue > 0 && <StatusBadge status="overdue" count={eq.overdue} />}
                  {eq.dueSoon > 0 && <StatusBadge status="due_soon" count={eq.dueSoon} />}
                  {eq.overdue === 0 && eq.dueSoon === 0 && (
                    <span className="text-xs text-green-600 font-medium">Всё в порядке</span>
                  )}
                  <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Кнопка быстрого доступа для НП */}
        {profile.role === 'production_manager' && (
          <div className="mt-6">
            <Link
              href="/equipment"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Перейти к оборудованию
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}
