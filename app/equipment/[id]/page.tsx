import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import Navigation from '@/components/Navigation'
import EquipmentDetailClient from './EquipmentDetailClient'
import {
  calcTaskStatus, FREQUENCY_LABELS, ROLE_LABELS, STATUS_LABELS,
  type Equipment, type MaintenanceTask, type MaintenanceLog, type Profile, type TaskStatus, type Frequency
} from '@/lib/types'

const freqOrder: Frequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'biannual', 'annual']

export type LogWithName = MaintenanceLog & { profiles?: { name: string } }

export interface TaskWithMeta extends MaintenanceTask {
  taskStatus: TaskStatus
  nextDue: Date
  lastLog: LogWithName | null
  todayLog: LogWithName | null
}

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

  const today = new Date().toISOString().split('T')[0]
  const { data: todayLogs } = taskIds.length > 0
    ? await supabase
        .from('maintenance_logs')
        .select('*, profiles!performed_by(name)')
        .in('task_id', taskIds)
        .eq('performed_at', today)
    : { data: [] }

  const taskList = tasks as MaintenanceTask[] || []
  const logList = logs as LogWithName[] || []
  const todayLogList = todayLogs as LogWithName[] || []

  const lastLogByTask: Record<string, LogWithName> = {}
  for (const log of logList) {
    if (!lastLogByTask[log.task_id]) lastLogByTask[log.task_id] = log
  }

  const todayLogByTask: Record<string, LogWithName> = {}
  for (const log of todayLogList) {
    todayLogByTask[log.task_id] = log
  }

  // Группируем задачи по периодичности (правильная типизация, без as never — BUG-12)
  const grouped = Object.fromEntries(freqOrder.map(f => [f, [] as TaskWithMeta[]])) as Record<Frequency, TaskWithMeta[]>

  for (const task of taskList) {
    const lastLog = lastLogByTask[task.id] || null
    const todayLog = todayLogByTask[task.id] || null
    const { status, nextDue } = calcTaskStatus(task.frequency, lastLog)
    grouped[task.frequency].push({ ...task, taskStatus: status, nextDue, lastLog, todayLog })
  }

  const equipment = eq as Equipment
  const isPM = profile.role === 'production_manager'

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

        <EquipmentDetailClient
          freqOrder={freqOrder}
          grouped={grouped}
          userId={user.id}
          isPM={isPM}
          frequencyLabels={FREQUENCY_LABELS}
          roleLabels={ROLE_LABELS}
        />
      </main>
    </div>
  )
}
