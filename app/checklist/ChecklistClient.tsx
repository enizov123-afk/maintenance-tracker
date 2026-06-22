'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { compressImage } from '@/lib/compress-image'
import type { Equipment, MaintenanceTask, TaskStatus, Frequency } from '@/lib/types'

interface DueTask extends MaintenanceTask {
  taskStatus: TaskStatus
  lastPerformed: string | null
  alreadyLoggedToday: boolean
  todayLogStatus: string | null
}

interface DueItem {
  equipment: Equipment
  tasks: DueTask[]
}

interface Props {
  dueItems: DueItem[]
  userId: string
  frequencyLabels: Record<Frequency, string>
  roleLabels: Record<string, string>
}

type TaskDecision = 'done' | 'skipped' | null

export default function ChecklistClient({ dueItems, userId, frequencyLabels, roleLabels }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // Состояние: taskId → { decision, note }
  const [decisions, setDecisions] = useState<Record<string, { decision: TaskDecision; note: string }>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Фото: taskId → сжатый File (до сабмита)
  const [photos, setPhotos] = useState<Record<string, File>>({})
  // Превью: taskId → object URL для отображения
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({})
  // Ошибки обработки/загрузки фото
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({})
  // Подтверждена ли отметка "Выполнено" (черновик → подтверждено)
  const [confirmedDone, setConfirmedDone] = useState<Record<string, boolean>>({})

  const allTaskIds = dueItems.flatMap(item => item.tasks.map(t => t.id))
  const decidedCount = allTaskIds.filter(id => decisions[id]?.decision).length

  const setDecision = (taskId: string, decision: TaskDecision) => {
    // Если снимаем "Выполнено" — удаляем фото и сбрасываем подтверждение
    if (decision !== 'done' && decisions[taskId]?.decision === 'done') {
      handlePhotoRemove(taskId)
      setConfirmedDone(prev => ({ ...prev, [taskId]: false }))
    }
    setDecisions(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], decision, note: prev[taskId]?.note || '' }
    }))
  }

  // Подтвердить черновик "Выполнено" — закрепляет отметку
  const handleConfirmDone = (taskId: string) => {
    setConfirmedDone(prev => ({ ...prev, [taskId]: true }))
  }

  // Снова открыть черновик после подтверждения — ничего не удаляет
  const handleReopenDone = (taskId: string) => {
    setConfirmedDone(prev => ({ ...prev, [taskId]: false }))
  }

  const setNote = (taskId: string, note: string) => {
    setDecisions(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], note, decision: prev[taskId]?.decision || null }
    }))
  }

  const handlePhotoSelect = async (taskId: string, file: File) => {
    // Валидация размера до сжатия
    if (file.size > 10 * 1024 * 1024) {
      setPhotoErrors(prev => ({ ...prev, [taskId]: 'Файл слишком большой, максимум 10MB' }))
      return
    }

    setPhotoErrors(prev => ({ ...prev, [taskId]: '' }))

    try {
      const compressed = await compressImage(file)
      const previewUrl = URL.createObjectURL(compressed)

      // Освободить предыдущий object URL если был
      if (photoPreviews[taskId]) {
        URL.revokeObjectURL(photoPreviews[taskId])
      }

      setPhotos(prev => ({ ...prev, [taskId]: compressed }))
      setPhotoPreviews(prev => ({ ...prev, [taskId]: previewUrl }))
    } catch {
      setPhotoErrors(prev => ({ ...prev, [taskId]: 'Не удалось обработать изображение' }))
    }
  }

  const handlePhotoRemove = (taskId: string) => {
    if (photoPreviews[taskId]) {
      URL.revokeObjectURL(photoPreviews[taskId])
    }
    setPhotos(prev => { const n = { ...prev }; delete n[taskId]; return n })
    setPhotoPreviews(prev => { const n = { ...prev }; delete n[taskId]; return n })
    setPhotoErrors(prev => ({ ...prev, [taskId]: '' }))
  }

  const handleSubmit = async () => {
    setSaving(true)
    setSubmitError(null)
    const today = new Date().toISOString().split('T')[0]

    const logsToUpsert = allTaskIds
      .filter(id => decisions[id]?.decision)
      .map(id => ({
        task_id: id,
        performed_at: today,
        performed_by: userId,
        status: decisions[id].decision as 'done' | 'skipped',
        note: decisions[id].note || null,
        verified: false,
        photo_url: null as string | null,
      }))

    if (logsToUpsert.length === 0) {
      setSaving(false)
      return
    }

    // 1. Сначала upsert логов чтобы получить id записей
    const { data: insertedLogs, error: insertError } = await supabase
      .from('maintenance_logs')
      .upsert(logsToUpsert, { onConflict: 'task_id,performed_at' })
      .select('id, task_id')

    if (insertError) {
      setSubmitError('Не удалось сохранить: ' + insertError.message)
      setSaving(false)
      return
    }

    // 2. Загрузить фото для задач с решением 'done'
    if (insertedLogs) {
      for (const log of insertedLogs) {
        const file = photos[log.task_id]
        if (!file) continue

        const path = `${userId}/${log.id}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('maintenance-photos')
          .upload(path, file, { upsert: true, contentType: 'image/jpeg' })

        if (uploadError) {
          setSubmitError('Ошибка загрузки фото: ' + uploadError.message)
          setSaving(false)
          return
        }

        const { data: urlData } = supabase.storage
          .from('maintenance-photos')
          .getPublicUrl(path)

        // 3. Обновить лог с photo_url
        const { error: updateError } = await supabase
          .from('maintenance_logs')
          .update({ photo_url: urlData.publicUrl })
          .eq('id', log.id)

        if (updateError) {
          setSubmitError('Ошибка сохранения ссылки на фото: ' + updateError.message)
          setSaving(false)
          return
        }
      }
    }

    setSaved(true)
    setSaving(false)
    setTimeout(() => {
      router.push('/dashboard')
      router.refresh()
    }, 1500)
  }

  if (saved) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-medium text-gray-900">Сохранено!</p>
        <p className="text-sm text-gray-500 mt-1">Перенаправляем на дашборд...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Прогресс */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-blue-800">
          Отмечено <strong>{decidedCount}</strong> из <strong>{allTaskIds.length}</strong> задач
        </p>
        <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${allTaskIds.length > 0 ? (decidedCount / allTaskIds.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Задачи по оборудованию */}
      {dueItems.map(({ equipment, tasks }) => (
        <div key={equipment.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="font-semibold text-gray-900">{equipment.name}</h2>
          </div>

          <div className="divide-y divide-gray-50">
            {tasks.map(task => {
              const decision = decisions[task.id]?.decision || null
              const note = decisions[task.id]?.note || ''
              const confirmed = confirmedDone[task.id] || false

              return (
                <div key={task.id} className={`px-4 py-3 ${decision === 'done' ? 'bg-green-50/50' : decision === 'skipped' ? 'bg-gray-50' : ''}`}>
                  <div className="flex items-start gap-3">
                    {/* Иконка статуса */}
                    <div className="flex-shrink-0 mt-0.5">
                      {task.taskStatus === 'overdue' ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-100">
                          <span className="w-2 h-2 rounded-full bg-yellow-400" />
                        </span>
                      )}
                    </div>

                    {/* Содержимое */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 leading-snug">{task.description}</p>
                      <div className="flex gap-3 mt-1">
                        <span className="text-xs text-gray-400">{frequencyLabels[task.frequency as Frequency]}</span>
                        <span className="text-xs text-gray-400">{roleLabels[task.assignee_role] || task.assignee_role}</span>
                        {task.lastPerformed && (
                          <span className="text-xs text-gray-400">
                            Последнее: {new Date(task.lastPerformed + 'T00:00:00').toLocaleDateString('ru-RU')}
                          </span>
                        )}
                      </div>

                      {/* Примечание при пропуске */}
                      {decision === 'skipped' && (
                        <div className="mt-2">
                          <label
                            htmlFor={`note-${task.id}`}
                            className="block text-xs font-medium text-gray-500 mb-1"
                          >
                            Причина пропуска
                          </label>
                          <input
                            id={`note-${task.id}`}
                            type="text"
                            placeholder="Например: нет расходников"
                            value={note}
                            onChange={e => setNote(task.id, e.target.value)}
                            className="w-full text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      {/* Фото — только при выполнении, до сабмита */}
                      {decision === 'done' && (
                        <div className="mt-3">
                          {photoPreviews[task.id] ? (
                            <div>
                              {/* Превью — достаточно крупный чтобы оценить чёткость */}
                              <img
                                src={photoPreviews[task.id]}
                                alt="Фото выполненной работы"
                                className="w-full rounded-lg object-contain bg-gray-100"
                                style={{ maxHeight: '200px' }}
                              />
                              {photoErrors[task.id] && (
                                <p className="mt-1 text-xs text-red-600">⚠ {photoErrors[task.id]}</p>
                              )}
                              <div className="flex gap-3 mt-2">
                                <label className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer">
                                  🔄 Заменить фото
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
                            <div>
                              <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 cursor-pointer border border-dashed border-gray-300 hover:border-blue-400 rounded-lg px-3 py-2 transition-colors">
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
                              {photoErrors[task.id] && (
                                <p className="mt-1 text-xs text-red-600">⚠ {photoErrors[task.id]}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Кнопки */}
                    <div className="flex gap-2 flex-shrink-0">
                      {decision === 'done' && !confirmed ? (
                        <>
                          <button
                            onClick={() => handleConfirmDone(task.id)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white transition-colors"
                          >
                            ✓ Подтвердить
                          </button>
                          <button
                            onClick={() => setDecision(task.id, null)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            ✕ Отменить
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              if (decision === 'done' && confirmed) {
                                // Подтверждённую отметку повторный клик не снимает —
                                // открывает черновик заново, без удаления фото
                                handleReopenDone(task.id)
                              } else {
                                setDecision(task.id, decision === 'done' ? null : 'done')
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              decision === 'done'
                                ? 'bg-green-600 text-white'
                                : 'bg-white border border-gray-300 text-gray-700 hover:bg-green-50 hover:border-green-300'
                            }`}
                          >
                            ✓ Выполнено
                          </button>
                          <button
                            onClick={() => setDecision(task.id, decision === 'skipped' ? null : 'skipped')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              decision === 'skipped'
                                ? 'bg-gray-600 text-white'
                                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            Пропустить
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Кнопка сохранения */}
      <div className="pt-2">
        <div className="flex items-center gap-4">
          <button
            onClick={handleSubmit}
            disabled={saving || decidedCount === 0}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Сохранение...' : `Сохранить (${decidedCount})`}
          </button>
          {decidedCount < allTaskIds.length && (
            <p className="text-sm text-gray-400">
              Осталось отметить: {allTaskIds.length - decidedCount}
            </p>
          )}
        </div>
        {submitError && (
          <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
            <span aria-hidden="true">⚠</span>
            {submitError}
          </p>
        )}
      </div>
    </div>
  )
}
