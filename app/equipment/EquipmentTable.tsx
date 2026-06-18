'use client'

import { useRouter } from 'next/navigation'
import { calcTaskStatus, STATUS_LABELS, type Equipment, type MaintenanceTask, type MaintenanceLog } from '@/lib/types'

interface Props {
  equipmentList: Equipment[]
  taskList: MaintenanceTask[]
  logList: MaintenanceLog[]
}

export default function EquipmentTable({ equipmentList, taskList, logList }: Props) {
  const router = useRouter()

  const lastLogByTask: Record<string, MaintenanceLog> = {}
  for (const log of logList) {
    if (!lastLogByTask[log.task_id]) lastLogByTask[log.task_id] = log
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    maintenance: 'bg-yellow-100 text-yellow-800',
    decommissioned: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Оборудование</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Статус</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Работ</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Просрочено</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Скоро</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {equipmentList.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                  Оборудование не добавлено
                </td>
              </tr>
            ) : equipmentList.map((eq, idx) => {
              const eqTasks = taskList.filter(t => t.equipment_id === eq.id)
              let overdue = 0, dueSoon = 0
              for (const task of eqTasks) {
                const { status } = calcTaskStatus(task.frequency, lastLogByTask[task.id] || null)
                if (status === 'overdue') overdue++
                else if (status === 'due_soon') dueSoon++
              }
              return (
                <tr
                  key={eq.id}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${idx % 2 === 0 ? '' : 'bg-gray-50/30'}`}
                  onClick={() => router.push(`/equipment/${eq.id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{eq.name}</p>
                    {eq.model && <p className="text-xs text-gray-400">{eq.model}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColors[eq.status]}`}>
                      {STATUS_LABELS[eq.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">{eqTasks.length}</td>
                  <td className="px-4 py-3 text-center">
                    {overdue > 0 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold">{overdue}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {dueSoon > 0 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-100 text-yellow-700 text-xs font-bold">{dueSoon}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-blue-600 text-xs font-medium">
                      Открыть →
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
