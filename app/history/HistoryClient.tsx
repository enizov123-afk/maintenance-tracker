'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useRouter, usePathname } from 'next/navigation'
import type { Equipment, Frequency } from '@/lib/types'

interface LogEntry {
  id: string
  task_id: string
  performed_at: string
  status: 'done' | 'skipped'
  note: string | null
  photo_url: string | null
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
  isOwner: boolean
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
  isOwner,
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

  // Модалка фото
  const [modalPhoto, setModalPhoto] = useState<string | null>(null)
  const [modalLogId, setModalLogId] = useState<string | null>(null)

  // Закрытие модалки по ESC
  useEffect(() => {
    if (!modalPhoto) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModalPhoto(null)
        setModalLogId(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [modalPhoto])

  // Клиентская фильтрация по оборудованию и статусу
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
      setVerifyError('Ошибка верификации: ' + error.message)
    } else {
      router.refresh()
    }
    setVerifying(null)
  }

  const handleExport = async () => {
    setExporting(true)
    const params = new URLSearchParams()
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (filterEq !== 'all') params.set('equipment', filterEq)
    if (filterStatus !== 'all') params.set('status', filterStatus)

    const url = `/api/export?${params.toString()}`
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

      {/* Inline-ошибка верификации */}
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
                      <div className="flex items-center gap-2">
                        {/* Иконка фото — кликабельна если есть */}
                        {log.photo_url && (
                          <button
                            onClick={() => {
                              setModalPhoto(log.photo_url!)
                              setModalLogId(log.id)
                            }}
                            className="text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0"
                            title="Посмотреть фото"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}

                        {/* Статус верификации / кнопка для собственника */}
                        {log.verified ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Верифицировано
                          </span>
                        ) : isOwner ? (
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
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Пагинация */}
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

      {/* Модалка просмотра фото */}
      {modalPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => {
            setModalPhoto(null)
            setModalLogId(null)
          }}
        >
          <div
            className="relative bg-white rounded-2xl overflow-hidden max-w-2xl w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Фото */}
            <img
              src={modalPhoto}
              alt="Фото выполненной работы"
              className="w-full object-contain bg-gray-100"
              style={{ maxHeight: '70vh' }}
            />

            {/* Кнопки */}
            <div className="flex items-center justify-between p-4 border-t border-gray-100">
              {isOwner && modalLogId && !logs.find(l => l.id === modalLogId)?.verified ? (
                <button
                  onClick={async () => {
                    if (modalLogId) {
                      await handleVerify(modalLogId)
                      setModalPhoto(null)
                      setModalLogId(null)
                    }
                  }}
                  disabled={verifying === modalLogId}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {verifying === modalLogId ? 'Сохранение...' : '✓ Верифицировать'}
                </button>
              ) : (
                <span className="text-sm text-green-700 font-medium">
                  {logs.find(l => l.id === modalLogId)?.verified ? '✓ Уже верифицировано' : ''}
                </span>
              )}
              <button
                onClick={() => {
                  setModalPhoto(null)
                  setModalLogId(null)
                }}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
