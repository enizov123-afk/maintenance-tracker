import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import Navigation from '@/components/Navigation'
import {
  calcTaskStatus, FREQUENCY_LABELS, ROLE_LABELS, STATUS_LABELS,
  type Equipment, type MaintenanceTask, type MaintenanceLog, type Profile, type TaskStatus, type Frequency
} from '@/lib/types'

function StatusChip({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; cls: string }> = {
    ok: { label: 'В порядке', cls: 'bg-green-100 text-green-800' },
    due_soon: { label: 'Скоро', cls: 'bg-yellow-100 text-yellow-800' },
    overdue: { label: 'Просрочено', cls: 'bg-red-100 text-red-800' },
  }
  const { label, cls } = map[status]
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
}

const freqOrder: Frequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'biannual', 'annual']

export default async function EquipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const { data: eq } = await supabase.from('equipment').select('*').eq('id', id).single()
  if (!eq) notFound()

  const { data: tasks } = await supabase
    .from('maintenance_tasks')
    .select('*')
    .eq('equipment_id', id)
    .eq('is_active', true)
    .order('sort_order')

  const taskIds = (tasks || []).map((t: MaintenanceTask) => t.id)

  const { data: logs } = taskIds.length > 0
    ? await supabase
        .from('maintenance_logs')
        .select('*, profiles!performed_by(name)')
        .in('task_id', taskIds)
        .eq('status', 'done')
        .order('performed_at', { ascending: false })
    : { data: [] }

  const taskList = tasks as MaintenanceTask[] || []
  const logList = logs as (MaintenanceLog & { profiles?: { name: string } })[] || []

  const lastLogByTask: Record<string, MaintenanceLog & { profiles?: { name: string } }> = {}
  for (const log of logList) {
    if (!lastLogByTask[log.task_id]) lastLogByTask[log.task_id] = log
  }

  // Группируем задачи по периодичности (правильная типизация, без as never — BUG-12)
  type TaskWithMeta = MaintenanceTask & {
    taskStatus: TaskStatus
    nextDue: Date
    lastLog: (MaintenanceLog & { profiles?: { name: string } }) | null
  }
  const grouped = Object.fromEntries(freqOrder.map(f => [f, [] as TaskWithMeta[]])) as Record<Frequency, TaskWithMeta[]>
  for (const freq of freqOrder) grouped[freq] = []

  for (const task of taskList) {
    const lastLog = lastLogByTask[task.id] || null
    const { status, nextDue } = calcTaskStatus(task.frequency, lastLog)
    grouped[task.frequency].push({ ...task, taskStatus: status, nextDue, lastLog })
  }

  const equipment = eq as Equipment

  return (
    <div className="min-h-screen md:flex">
      <Navigation profile={profile as Profile} />
      <main className="flex-1 p-4 sm:p-6">
        {/* Хлебные крошки */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link href="/equipment" className="hover:text-gray-900">Оборудование</Link>
          <span>/</span>
          <span className="text-gray-900">{equipment.name}</span>
        </div>

        {/* Заголовок */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{equipment.name}</h1>
            {equipment.model && <p className="text-sm text-gray-500 mt-0.5">Модель: {equipment.model}</p>}
          </div>
          <span className={`inline-flex px-3 py-1 rounded-lg text-sm font-medium ${
            equipment.status === 'active' ? 'bg-green-100 text-green-800' :
            equipment.status === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
            'bg-gray-100 text-gray-600'
          }`}>
            {STATUS_LABELS[equipment.status]}
          </span>
        </div>

        {/* Регламентные работы по группам */}
        <div className="space-y-6">
          {freqOrder.map(freq => {
            const groupTasks = grouped[freq]
            if (groupTasks.length === 0) return null

            return (
              <div key={freq}>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {FREQUENCY_LABELS[freq]}
                </h2>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Работа</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Исполнитель</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Последнее выполнение</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Следующее</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupTasks.map(task => (
                        <tr key={task.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-gray-900 max-w-xs">
                            <p className="leading-snug">{task.description}</p>
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            {ROLE_LABELS[task.assignee_role] || task.assignee_role}
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            {task.lastLog ? (
                              <div>
                                <p>{new Date(task.lastLog.performed_at + 'T00:00:00').toLocaleDateString('ru-RU')}</p>
                                {task.lastLog.profiles?.name && (
                                  <p className="text-xs text-gray-400">{task.lastLog.profiles.name}</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300">Не выполнялась</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            <span className={task.taskStatus === 'overdue' ? 'text-red-500' : ''}>
                              {task.nextDue.toLocaleDateString('ru-RU')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusChip status={task.taskStatus} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
