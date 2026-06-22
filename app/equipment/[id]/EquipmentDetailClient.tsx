'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { compressImage } from '@/lib/compress-image'
import type { Frequency, TaskStatus } from '@/lib/types'
import type { TaskWithMeta } from './page'

interface Props {
  freqOrder: Frequency[]
  grouped: Record<Frequency, TaskWithMeta[]>
  userId: string
  isPM: boolean
  frequencyLabels: Record<Frequency, string>
  roleLabels: Record<string, string>
}

function StatusChip({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; cls: string }> = {
    ok: { label: 'В порядке', cls: 'bg-green-100 text-green-800' },
    due_soon: { label: 'Скоро', cls: 'bg-yellow-100 text-yellow-800' },
    overdue: { label: 'Просрочено', cls: 'bg-red-100 text-red-800' },
  }
  const { label, cls } = map[status]
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
}

function PhotoIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Посмотреть фото"
      className="text-gray-400 hover:text-blue-600 flex-shrink-0"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>
  )
}

export default function EquipmentDetailClient({ freqOrder, grouped, userId, isPM, frequencyLabels, roleLabels }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // Черновик "Выполнено"/"Пропустить" до сохранения в БД
  const [decisions, setDecisions] = useState<Record<string, 'done'>>({})
  const [photos, setPhotos] = useState<Record<string, File>>({})
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({})
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({})
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [cancellingLogId, setCancellingLogId] = useState<string | null>(null)
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})
  const [modalPhoto, setModalPhoto] = useState<string | null>(null)

  // Esc закрывает модалку с фото
  useEffect(() => {
    if (!modalPhoto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalPhoto(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalPhoto])

  const today = () => new Date().toISOString().split('T')[0]

  const handlePhotoSelect = async (taskId: string, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setPhotoErrors(prev => ({ ...prev, [taskId]: 'Файл слишком большой, максимум 10MB' }))
      return
    }
    setPhotoErrors(prev => ({ ...prev, [taskId]: '' }))
    try {
      const compressed = await compressImage(file)
      const previewUrl = URL.createObjectURL(compressed)
      if (photoPreviews[taskId]) URL.revokeObjectURL(photoPreviews[taskId])
      setPhotos(prev => ({ ...prev, [taskId]: compressed }))
      setPhotoPreviews(prev => ({ ...prev, [taskId]: previewUrl }))
    } catch {
      setPhotoErrors(prev => ({ ...prev, [taskId]: 'Не удалось обработать изображение' }))
    }
  }

  const handlePhotoRemove = (taskId: string) => {
    if (photoPreviews[taskId]) URL.revokeObjectURL(photoPreviews[taskId])
    setPhotos(prev => { const n = { ...prev }; delete n[taskId]; return n })
    setPhotoPreviews(prev => { const n = { ...prev }; delete n[taskId]; return n })
    setPhotoErrors(prev => ({ ...prev, [taskId]: '' }))
  }

  const startDraft = (taskId: string) => {
    setTaskErrors(prev => ({ ...prev, [taskId]: '' }))
    setDecisions(prev => ({ ...prev, [taskId]: 'done' }))
  }

  const cancelDraft = (taskId: string) => {
    handlePhotoRemove(taskId)
    setDecisions(prev => { const n = { ...prev }; delete n[taskId]; return n })
    setTaskErrors(prev => ({ ...prev, [taskId]: '' }))
  }

  const handleConfirmDone = async (taskId: string) => {
    setSavingTaskId(taskId)
    setTaskErrors(prev => ({ ...prev, [taskId]: '' }))

    const { data: inserted, error: insertError } = await supabase
      .from('maintenance_logs')
      .upsert({
        task_id: taskId,
        performed_at: today(),
        performed_by: userId,
        status: 'done',
        note: null,
        verified: false,
        photo_url: null,
      }, { onConflict: 'task_id,performed_at' })
      .select('id')
      .single()

    if (insertError || !inserted) {
      setTaskErrors(prev => ({ ...prev, [taskId]: 'Не удалось сохранить: ' + (insertError?.message || 'ошибка') }))
      setSavingTaskId(null)
      return
    }

    const file = photos[taskId]
    if (file) {
      const path = `${userId}/${inserted.id}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('maintenance-photos')
        .upload(path, file, { upsert: true, contentType: 'image/jpeg' })

      if (uploadError) {
        setTaskErrors(prev => ({ ...prev, [taskId]: 'Ошибка загрузки фото: ' + uploadError.message }))
        setSavingTaskId(null)
        return
      }

      const { data: urlData } = supabase.storage.from('maintenance-photos').getPublicUrl(path)
      const { error: updateError } = await supabase
        .from('maintenance_logs')
        .update({ photo_url: urlData.publicUrl })
        .eq('id', inserted.id)

      if (updateError) {
        setTaskErrors(prev => ({ ...prev, [taskId]: 'Ошибка сохранения фото: ' + updateError.message }))
        setSavingTaskId(null)
        return
      }
    }

    handlePhotoRemove(taskId)
    setDecisions(prev => { const n = { ...prev }; delete n[taskId]; return n })
    setSavingTaskId(null)
    router.refresh()
  }

  const handleSkip = async (taskId: string) => {
    setSavingTaskId(taskId)
    setTaskErrors(prev => ({ ...prev, [taskId]: '' }))

    const { error } = await supabase
      .from('maintenance_logs')
      .upsert({
        task_id: taskId,
        performed_at: today(),
        performed_by: userId,
        status: 'skipped',
        note: null,
        verified: false,
        photo_url: null,
      }, { onConflict: 'task_id,performed_at' })

    if (error) {
      setTaskErrors(prev => ({ ...prev, [taskId]: 'Не удалось сохранить: ' + error.message }))
      setSavingTaskId(null)
      return
    }

    setSavingTaskId(null)
    router.refresh()
  }

  const handleCancelSaved = async (logId: string, taskId: string, status: 'done' | 'skipped') => {
    const message = status === 'done'
      ? 'Удалить отметку о выполнении? Прикреплённое фото будет потеряно.'
      : 'Удалить отметку о пропуске?'
    if (!window.confirm(message)) return

    setCancellingLogId(logId)
    setTaskErrors(prev => ({ ...prev, [taskId]: '' }))

    const { error } = await supabase.from('maintenance_logs').delete().eq('id', logId)

    if (error) {
      setTaskErrors(prev => ({ ...prev, [taskId]: 'Не удалось отменить: ' + error.message }))
      setCancellingLogId(null)
      return
    }

    setCancellingLogId(null)
    router.refresh()
  }

  const handleNoteBlur = async (logId: string, note: string) => {
    await supabase.from('maintenance_logs').update({ note: note || null }).eq('id', logId)
  }

  return (
    <>
      <div className="space-y-6">
        {freqOrder.map(freq => {
          const groupTasks = grouped[freq]
          if (groupTasks.length === 0) return null

          return (
            <div key={freq}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {frequencyLabels[freq]}
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
                      {groupTasks.map(task => {
                        const todayLog = task.todayLog
                        const isActionable = isPM && (task.taskStatus === 'overdue' || task.taskStatus === 'due_soon')
                        const isDraft = decisions[task.id] === 'done'
                        const saving = savingTaskId === task.id
                        const cancelling = todayLog ? cancellingLogId === todayLog.id : false
                        const error = taskErrors[task.id]

                        return (
                          <tr key={task.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 align-top">
                            <td className="px-4 py-3 text-gray-900 max-w-xs">
                              <p className="leading-snug">{task.description}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                              {roleLabels[task.assignee_role] || task.assignee_role}
                            </td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                              {task.lastLog ? (
                                <div className="flex items-center gap-1.5">
                                  <div>
                                    <p>{new Date(task.lastLog.performed_at + 'T00:00:00').toLocaleDateString('ru-RU')}</p>
                                    {task.lastLog.profiles?.name && (
                                      <p className="text-xs text-gray-400">{task.lastLog.profiles.name}</p>
                                    )}
                                  </div>
                                  {task.lastLog.photo_url && (
                                    <PhotoIconButton onClick={() => setModalPhoto(task.lastLog!.photo_url!)} />
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
                            <td className="px-4 py-3 min-w-[160px]">
                              {todayLog ? (
                                todayLog.status === 'done' ? (
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {todayLog.photo_url && (
                                        <PhotoIconButton onClick={() => setModalPhoto(todayLog.photo_url!)} />
                                      )}
                                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                        ✓ Выполнено
                                      </span>
                                      {isPM && (
                                        <button
                                          onClick={() => handleCancelSaved(todayLog.id, task.id, 'done')}
                                          disabled={cancelling}
                                          className="text-xs text-gray-400 hover:text-red-500 font-medium disabled:opacity-50"
                                        >
                                          {cancelling ? 'Удаление...' : '✕ Отменить'}
                                        </button>
                                      )}
                                    </div>
                                    {error && <p className="text-xs text-red-600 mt-1">⚠ {error}</p>}
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">
                                        Пропущено
                                      </span>
                                      {isPM && (
                                        <button
                                          onClick={() => handleCancelSaved(todayLog.id, task.id, 'skipped')}
                                          disabled={cancelling}
                                          className="text-xs text-gray-400 hover:text-red-500 font-medium disabled:opacity-50"
                                        >
                                          {cancelling ? 'Удаление...' : '✕ Отменить'}
                                        </button>
                                      )}
                                    </div>
                                    {isPM && (
                                      <input
                                        type="text"
                                        defaultValue={todayLog.note || ''}
                                        onBlur={e => handleNoteBlur(todayLog.id, e.target.value)}
                                        placeholder="Причина пропуска"
                                        className="text-xs px-2 py-1 border border-gray-200 rounded w-full max-w-[180px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                                      />
                                    )}
                                    {error && <p className="text-xs text-red-600">⚠ {error}</p>}
                                  </div>
                                )
                              ) : isActionable && isDraft ? (
                                <div className="space-y-2 min-w-[160px]">
                                  {photoPreviews[task.id] ? (
                                    <div>
                                      <img
                                        src={photoPreviews[task.id]}
                                        alt="Фото выполненной работы"
                                        className="w-full max-w-[160px] rounded object-contain bg-gray-100"
                                        style={{ maxHeight: '120px' }}
                                      />
                                      <div className="flex gap-2 mt-1">
                                        <label className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer">
                                          🔄 Заменить
                                          <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={e => {
                                              const file = e.target.files?.[0]
                                              if (file) handlePhotoSelect(task.id, file)
                                              e.target.value = ''
                                            }}
                                          />
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => handlePhotoRemove(task.id)}
                                          className="text-xs text-gray-400 hover:text-red-500 font-medium"
                                        >
                                          ✕ Удалить
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 cursor-pointer border border-dashed border-gray-300 hover:border-blue-400 rounded-lg px-2 py-1.5 transition-colors">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      Прикрепить фото
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={e => {
                                          const file = e.target.files?.[0]
                                          if (file) handlePhotoSelect(task.id, file)
                                          e.target.value = ''
                                        }}
                                      />
                                    </label>
                                  )}
                                  {photoErrors[task.id] && (
                                    <p className="text-xs text-red-600">⚠ {photoErrors[task.id]}</p>
                                  )}
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleConfirmDone(task.id)}
                                      disabled={saving}
                                      className="px-2 py-1 rounded text-xs font-medium bg-green-600 text-white disabled:opacity-50 transition-colors"
                                    >
                                      {saving ? 'Сохранение...' : '✓ Подтвердить'}
                                    </button>
                                    <button
                                      onClick={() => cancelDraft(task.id)}
                                      disabled={saving}
                                      className="px-2 py-1 rounded text-xs font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                                    >
                                      ✕ Отменить
                                    </button>
                                  </div>
                                  {error && <p className="text-xs text-red-600">⚠ {error}</p>}
                                </div>
                              ) : isActionable ? (
                                <div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => startDraft(task.id)}
                                      className="px-2 py-1 rounded text-xs font-medium bg-white border border-gray-300 text-gray-700 hover:bg-green-50 hover:border-green-300 transition-colors"
                                    >
                                      ✓ Выполнено
                                    </button>
                                    <button
                                      onClick={() => handleSkip(task.id)}
                                      disabled={saving}
                                      className="px-2 py-1 rounded text-xs font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                                    >
                                      {saving ? 'Сохранение...' : 'Пропустить'}
                                    </button>
                                  </div>
                                  {error && <p className="text-xs text-red-600 mt-1">⚠ {error}</p>}
                                </div>
                              ) : (
                                <StatusChip status={task.taskStatus} />
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {modalPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalPhoto(null)}
        >
          <div
            className="relative bg-white rounded-2xl overflow-hidden max-w-2xl w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={modalPhoto}
              alt="Фото выполненной работы"
              className="w-full object-contain bg-gray-100"
              style={{ maxHeight: '70vh' }}
            />
            <div className="flex items-center justify-end p-4 border-t border-gray-100">
              <button
                onClick={() => setModalPhoto(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
