import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import Navigation from '@/components/Navigation'
import ChecklistClient from './ChecklistClient'
import { calcTaskStatus, FREQUENCY_LABELS, ROLE_LABELS, type Equipment, type MaintenanceTask, type MaintenanceLog, type Profile } from '@/lib/types'

export default async function ChecklistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  // Только НП может отмечать работы
  if (profile.role !== 'production_manager') redirect('/dashboard')

  const { data: equipment } = await supabase.from('equipment').select('*').eq('status', 'active').order('sort_order')
  const { data: tasks } = await supabase.from('maintenance_tasks').select('*').eq('is_active', true).order('sort_order')

  // Используем view latest_done_logs — обходит лимит 1000 строк (BUG-01)
  const { data: logs } = await supabase.from('latest_done_logs').select('*')

  // Логи за сегодня (чтобы исключать уже отмеченные — и done, и skipped) (BUG-05)
  const today = new Date().toISOString().split('T')[0]
  const { data: todayLogs } = await supabase
    .from('maintenance_logs')
    .select('*')
    .eq('performed_at', today)

  const equipmentList = equipment as Equipment[] || []
  const taskList = tasks as MaintenanceTask[] || []
  const logList = logs as MaintenanceLog[] || []
  const todayLogList = todayLogs as MaintenanceLog[] || []

  const lastLogByTask: Record<string, MaintenanceLog> = {}
  for (const log of logList) {
    if (!lastLogByTask[log.task_id]) lastLogByTask[log.task_id] = log
  }

  const todayLogByTask: Record<string, MaintenanceLog> = {}
  for (const log of todayLogList) {
    todayLogByTask[log.task_id] = log
  }

  // Определяем задачи, требующие внимания (просроченные + скоро + ещё не отмеченные сегодня)
  const dueItems = []

  for (const eq of equipmentList) {
    const eqTasks = taskList.filter(t => t.equipment_id === eq.id)
    const dueTasks = []

    for (const task of eqTasks) {
      const lastLog = lastLogByTask[task.id] || null
      const { status } = calcTaskStatus(task.frequency, lastLog)
      // Исключаем задачи с ЛЮБЫМ логом за сегодня (done ИЛИ skipped) — BUG-05
      const alreadyLoggedToday = !!todayLogByTask[task.id]

      if ((status === 'overdue' || status === 'due_soon') && !alreadyLoggedToday) {
        dueTasks.push({
          ...task,
          taskStatus: status,
          lastPerformed: lastLog?.performed_at || null,
          alreadyLoggedToday: false,
          todayLogStatus: null,
        })
      }
    }

    if (dueTasks.length > 0) {
      dueItems.push({ equipment: eq, tasks: dueTasks })
    }
  }

  return (
    <div className="min-h-screen md:flex">
      <Navigation profile={profile as Profile} />
      <main className="flex-1 p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Отметка работ</h1>
          <p className="text-sm text-gray-500 mt-1">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {dueItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-900">Всё в порядке!</p>
            <p className="text-sm text-gray-500 mt-1">Нет просроченных или предстоящих работ</p>
          </div>
        ) : (
          <ChecklistClient
            dueItems={dueItems}
            userId={user.id}
            frequencyLabels={FREQUENCY_LABELS}
            roleLabels={ROLE_LABELS}
          />
        )}
      </main>
    </div>
  )
}
