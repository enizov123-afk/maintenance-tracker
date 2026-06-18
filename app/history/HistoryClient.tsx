'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useRouter, usePathname } from 'next/navigation'
import type { Equipment, Frequency } from '@/lib/types'

interface LogEntry {
  id: string
  task_id: string
  performed_at: string
  status: 'done' | 'skipped'
  note: string | null
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  maintenance_tasks: {
    description: string
    frequency: Frequency
    equipment_id: string
  } | null
  profiles: { name: string } | null
}

interface Props {
  logs: LogEntry[]
  equipment: Equipment[]
  isPM: boolean
  userId: string
  totalCount: number
  currentPage: number
  totalPages: number
  initialDateFrom: string | null
  initialDateTo: string | null
}

const FREQ_LABELS: Record<Frequency, string> = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  quarterly: 'Раз в 3 мес',
  biannual: 'Раз в 6 мес',
  annual: 'Раз в год',
}

export default function HistoryClient({
  logs,
  equipment,
  isPM,
  userId,
  totalCount,
  currentPage,
  totalPages,
  initialDateFrom,
  initialDateTo,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()

  const [filterEq, setFilterEq] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? '')
  const [dateTo, setDateTo] = useState(initialDateTo ?? '')
  const [verifying, setVerifying] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Клиентская фильтрация по оборудованию и статусу (не влияет на пагинацию)
  const filtered = logs.filter(log => {
    if (filterEq !== 'all' && log.maintenance_tasks?.equipment_id !== filterEq) return false
    if (filterStatus !== 'all' && log.status !== filterStatus) return false
    return true
  })

  const equipmentById: Record<string, Equipment> = {}
  for (const eq of equipment) equipmentById[eq.id] = eq

  const applyDateFilter = () => {
    const params = new URLSearchParams()
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    params.set('page', '0')
    router.push(`${pathname}?${params.toString()}`)
  }

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams()
    if (initialDateFrom) params.set('dateFrom', initialDateFrom)
    if (initialDateTo) params.set('dateTo', initialDateTo)
    params.set('page', String(newPage))
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleVerify = async (logId: string) => {
    setVerifying(logId)
    setVerifyError(null)
    const { error } = await supabase
      .from('maintenance_logs')
      .update({
        verified: true,
        verified_by: userId,
        verified_at: new Date().toISOString(),
      })
      .eq('id', logId)

    if (error) {
      // Inline-ошибка вместо alert() (UX-02)
      setVerifyError('Ошибка верификации: ' + error.message)
    } else {
      router.refresh()
    }
    setVerifying(null)
  }

  // Экспорт в Excel через API route (D2)
  const handleExport = async () => {
    setExporting(true)
    const params = new URLSearchParams()
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (filterEq !== 'all') params.set('equipment', filterEq)
    if (filterStatus !== 'all') params.set('status', filterStatus)

    const url = `/api/export?${params.toString()}`
    // Создаём временную ссылку для скачивания
    const a = document.createElement('a')
    a.href = url
    a.download = `history-${dateFrom || 'all'}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setExporting(false)
  }

  return (
    <div>
      {/* Фильтры */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Фильтр по дате (D1) */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 whitespace-nowrap">С:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 whitespace-nowrap">По:</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={applyDateFilter}
          className="text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Применить
        </button>

        <div className="w-px bg-gray-200 self-stretch hidden sm:block" />

        <select
          value={filterEq}
          onChange={e => setFilterEq(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Всё оборудование</option>
          {equipment.map(eq => (
            <option key={eq.id} value={eq.id}>{eq.name}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Все статусы</option>
          <option value="done">Выполнено</option>
          <option value="skipped">Пропущено</option>
        </select>

        <span className="text-sm text-gray-400 self-center">{filtered.length} из {totalCount}</span>

        {/* Кнопка экспорта в Excel (D2) */}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto text-sm border border-green-300 text-green-700 bg-green-50 px-3 py-2 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? 'Готовим...' : 'Excel'}
        </button>
      </div>

      {/* Inline-ошибка верификации (UX-02) */}
      {verifyError && (
        <p className="mb-3 text-sm text-red-600 flex items-center gap-1">
          <span aria-hidden="true">⚠</span>
          {verifyError}
        </p>
      )}

      {/* Таблица */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Дата</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Оборудование</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Работа</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Периодичность</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Статус</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Кто отметил</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Верификация</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Нет записей за выбранный период
                  </td>
                </tr>
              ) : filtered.map(log => {
                const eq = log.maintenance_tasks ? equipmentById[log.maintenance_tasks.equipment_id] : null
                return (
                  <tr key={log.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {new Date(log.performed_at + 'T00:00:00').toLocaleDateString('ru-RU')}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-[140px]">
                      <p className="truncate">{eq?.name || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-900 max-w-xs">
                      <p className="line-clamp-2 leading-snug">{log.maintenance_tasks?.description || '—'}</p>
                      {log.note && (
                        <p className="text-xs text-gray-400 mt-0.5 italic">{log.note}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {log.maintenance_tasks ? FREQ_LABELS[log.maintenance_tasks.frequency] : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        log.status === 'done'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {log.status === 'done' ? 'Выполнено' : 'Пропущено'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {log.profiles?.name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {log.verified ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Верифицировано
                        </span>
                      ) : isPM ? (
                        <button
                          onClick={() => handleVerify(log.id)}
                          disabled={verifying === log.id}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                        >
                          {verifying === log.id ? 'Сохранение...' : 'Верифицировать'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Пагинация (S2-06) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Страница {currentPage + 1} из {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 0}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Назад
            </button>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages - 1}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Вперёд →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
