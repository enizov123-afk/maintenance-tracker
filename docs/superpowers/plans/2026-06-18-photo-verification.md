# Photo Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить загрузку фото при отметке выполненной работы и исправить баг с ролями верификации (верифицировать должен только собственник).

**Architecture:** Добавляем колонку `photo_url` в `maintenance_logs`. НП загружает фото в Supabase Storage через ChecklistClient (с предпросмотром и возможностью замены до сабмита). Собственник видит фото в модалке в HistoryClient и верифицирует оттуда.

**Tech Stack:** Next.js 14, TypeScript, Supabase (Database + Storage), Tailwind CSS, Canvas API (сжатие на клиенте)

## Global Constraints

- Без `capture` атрибута на file input — пользователь сам выбирает камеру или галерею
- Сжатие: max 1200px по длинной стороне, JPEG quality 0.8
- Storage bucket: `maintenance-photos`, путь: `{userId}/{logId}.jpg`
- После нажатия "Сохранить" фото заблокировано — нет UI для замены
- Верификация только для роли `owner`, НП видит прочерк или "Верифицировано"
- Inline-ошибки везде, никаких `alert()`

---

## File Map

| Файл | Действие | Назначение |
|------|----------|-----------|
| `supabase/schema.sql` | Modify | Добавить миграцию `photo_url` |
| `lib/compress-image.ts` | Create | Утилита сжатия через Canvas API |
| `app/checklist/ChecklistClient.tsx` | Modify | Фото-пикер, превью, загрузка в Storage |
| `app/history/HistoryClient.tsx` | Modify | Фото-иконка, модалка, fix isPM→isOwner |
| `app/history/page.tsx` | Modify | Передавать `isOwner` вместо `isPM` |

---

## Task 1: Суpabase Storage + DB migration

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: bucket `maintenance-photos`, колонка `maintenance_logs.photo_url TEXT`

- [ ] **Шаг 1: Добавить миграцию в конец schema.sql**

Открыть `supabase/schema.sql` и добавить в самый конец файла:

```sql
-- ============================================================
-- Миграция: фото-верификация (2026-06-18)
-- ============================================================

-- Колонка для хранения URL фото в журнале
ALTER TABLE maintenance_logs ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Storage bucket для фотографий
INSERT INTO storage.buckets (id, name, public)
VALUES ('maintenance-photos', 'maintenance-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: только production_manager может загружать фото
CREATE POLICY "pm_can_upload_photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'maintenance-photos' AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'production_manager'
  )
);

-- RLS: только production_manager может перезаписывать фото
CREATE POLICY "pm_can_update_photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'maintenance-photos' AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'production_manager'
  )
);

-- RLS: все авторизованные могут читать фото
CREATE POLICY "authenticated_can_read_photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'maintenance-photos');
```

- [ ] **Шаг 2: Применить миграцию в Supabase**

Открыть Supabase Dashboard → SQL Editor → New query. Вставить только новый блок миграции (от `-- Миграция:` до конца). Нажать Run.

Проверить: в Table Editor → maintenance_logs должна появиться колонка `photo_url`. В Storage → Buckets должен появиться `maintenance-photos`.

- [ ] **Шаг 3: Commit**

```bash
cd maintenance-tracker
git add supabase/schema.sql
git commit -m "feat: add photo_url migration and storage bucket"
```

---

## Task 2: Утилита сжатия изображений

**Files:**
- Create: `lib/compress-image.ts`

**Interfaces:**
- Produces: `compressImage(file: File): Promise<File>` — принимает File, возвращает сжатый File (JPEG, ≤400KB)

- [ ] **Шаг 1: Создать файл `lib/compress-image.ts`**

```typescript
/**
 * Сжимает изображение на клиенте через Canvas API.
 * Масштабирует до max 1200px по длинной стороне, конвертирует в JPEG quality 0.8.
 * Результат: ~200–400KB вместо 5–10MB с телефона.
 */
export async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      const MAX_SIDE = 1200
      let { width, height } = img

      if (width > MAX_SIDE || height > MAX_SIDE) {
        if (width > height) {
          height = Math.round((height * MAX_SIDE) / width)
          width = MAX_SIDE
        } else {
          width = Math.round((width * MAX_SIDE) / height)
          height = MAX_SIDE
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context unavailable'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('Compression failed'))
            return
          }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
          }))
        },
        'image/jpeg',
        0.8
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}
```

- [ ] **Шаг 2: Проверить вручную (TypeScript-компиляция)**

```bash
cd maintenance-tracker
npx tsc --noEmit
```

Ожидаемый результат: никаких ошибок по `lib/compress-image.ts`.

- [ ] **Шаг 3: Commit**

```bash
git add lib/compress-image.ts
git commit -m "feat: add client-side image compression utility"
```

---

## Task 3: ChecklistClient — фото-пикер с предпросмотром

**Files:**
- Modify: `app/checklist/ChecklistClient.tsx`

**Interfaces:**
- Consumes: `compressImage` из `lib/compress-image.ts`
- Consumes: `supabase.storage.from('maintenance-photos').upload(path, file)`
- Consumes: `supabase.storage.from('maintenance-photos').getPublicUrl(path)`

- [ ] **Шаг 1: Добавить импорт и новое состояние**

В начало файла добавить импорт:
```typescript
import { compressImage } from '@/lib/compress-image'
```

В компоненте `ChecklistClient` после существующих `useState` добавить:
```typescript
// Фото: taskId → File (до сабмита)
const [photos, setPhotos] = useState<Record<string, File>>({})
// Превью: taskId → object URL для отображения
const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({})
// Ошибки загрузки фото
const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({})
```

- [ ] **Шаг 2: Добавить обработчик выбора фото**

После функции `setNote` добавить:

```typescript
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
```

- [ ] **Шаг 3: Обновить handleSubmit — загрузка фото перед записью в БД**

Заменить существующий `handleSubmit` на:

```typescript
const handleSubmit = async () => {
  setSaving(true)
  setSubmitError(null)
  const today = new Date().toISOString().split('T')[0]

  // 1. Подготовить логи
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

  // 2. Сначала upsert логов чтобы получить id записей
  const { data: insertedLogs, error: insertError } = await supabase
    .from('maintenance_logs')
    .upsert(logsToUpsert, { onConflict: 'task_id,performed_at' })
    .select('id, task_id')

  if (insertError) {
    setSubmitError('Не удалось сохранить: ' + insertError.message)
    setSaving(false)
    return
  }

  // 3. Загрузить фото для задач с решением 'done'
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

      // Обновить лог с photo_url
      await supabase
        .from('maintenance_logs')
        .update({ photo_url: urlData.publicUrl })
        .eq('id', log.id)
    }
  }

  setSaved(true)
  setSaving(false)
  setTimeout(() => {
    router.push('/dashboard')
    router.refresh()
  }, 1500)
}
```

- [ ] **Шаг 4: Добавить UI фото-пикера в JSX**

Найти блок `{/* Кнопки */}` в JSX (вокруг строки 186). После блока с кнопками "Выполнено"/"Пропустить", но внутри `<div className="flex-1 min-w-0">`, добавить блок фото (после блока с причиной пропуска):

```tsx
{/* Фото — только при выполнении */}
{decision === 'done' && (
  <div className="mt-3">
    {photoPreviews[task.id] ? (
      <div>
        {/* Превью */}
        <img
          src={photoPreviews[task.id]}
          alt="Фото выполненной работы"
          className="w-full rounded-lg object-contain bg-gray-100"
          style={{ maxHeight: '200px' }}
        />
        {/* Ошибка фото */}
        {photoErrors[task.id] && (
          <p className="mt-1 text-xs text-red-600">⚠ {photoErrors[task.id]}</p>
        )}
        {/* Кнопки управления */}
        <div className="flex gap-2 mt-2">
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
```

- [ ] **Шаг 5: Проверить TypeScript**

```bash
cd maintenance-tracker
npx tsc --noEmit
```

Ожидаемый результат: нет ошибок.

- [ ] **Шаг 6: Запустить приложение и проверить вручную**

```bash
npm run dev
```

Открыть http://localhost:3000/checklist. Войти как НП. Отметить задачу как "Выполнено" → должен появиться блок "Прикрепить фото". Выбрать файл → увидеть превью. Нажать "Заменить" → открывается пикер снова. Нажать "Удалить" → превью исчезает. Нажать "Сохранить" → редирект на дашборд.

- [ ] **Шаг 7: Commit**

```bash
git add app/checklist/ChecklistClient.tsx
git commit -m "feat: add photo upload with preview to checklist"
```

---

## Task 4: HistoryClient — фото-модалка и исправление ролей

**Files:**
- Modify: `app/history/HistoryClient.tsx`
- Modify: `app/history/page.tsx`

**Interfaces:**
- Consumes: `log.photo_url: string | null` (новое поле в LogEntry)
- Consumes: проп `isOwner: boolean` вместо `isPM: boolean`

- [ ] **Шаг 1: Обновить интерфейс LogEntry и Props**

В `HistoryClient.tsx` найти интерфейс `LogEntry` и добавить поле:
```typescript
interface LogEntry {
  id: string
  task_id: string
  performed_at: string
  status: 'done' | 'skipped'
  note: string | null
  photo_url: string | null   // ← добавить
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
```

В интерфейсе `Props` заменить `isPM: boolean` на `isOwner: boolean`:
```typescript
interface Props {
  logs: LogEntry[]
  equipment: Equipment[]
  isOwner: boolean          // ← было isPM
  userId: string
  totalCount: number
  currentPage: number
  totalPages: number
  initialDateFrom: string | null
  initialDateTo: string | null
}
```

- [ ] **Шаг 2: Добавить состояние модалки**

В компоненте `HistoryClient` в деструктуризации пропсов заменить `isPM` на `isOwner`. Затем добавить состояние модалки после существующих `useState`:

```typescript
// Модалка фото: null = закрыта, string = URL открытого фото
const [modalPhoto, setModalPhoto] = useState<string | null>(null)
// ID лога, чьё фото открыто (для верификации из модалки)
const [modalLogId, setModalLogId] = useState<string | null>(null)
```

- [ ] **Шаг 3: Добавить закрытие модалки по ESC**

После блока useState добавить:

```typescript
// Закрытие модалки по ESC
React.useEffect(() => {
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
```

Добавить импорт React в начало файла если его нет:
```typescript
import React, { useState } from 'react'
```

- [ ] **Шаг 4: Обновить колонку "Верификация" в таблице**

Найти блок `<td className="px-4 py-3">` для колонки верификации (последний `<td>` в строке таблицы). Заменить его содержимое целиком:

```tsx
<td className="px-4 py-3">
  <div className="flex items-center gap-2">
    {/* Иконка фото — если есть */}
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

    {/* Статус верификации */}
    {log.verified ? (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
```

- [ ] **Шаг 5: Добавить модальное окно в JSX**

В самый конец JSX, перед закрывающим `</div>` компонента, добавить:

```tsx
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
```

- [ ] **Шаг 6: Обновить history/page.tsx**

Открыть `app/history/page.tsx`. Найти где читается роль пользователя и где передаётся `isPM` в `HistoryClient`.

Найти строку вида:
```typescript
const isPM = profile?.role === 'production_manager'
```
Заменить на:
```typescript
const isOwner = profile?.role === 'owner'
```

Найти в JSX пропс `isPM={isPM}` и заменить на:
```tsx
isOwner={isOwner}
```

- [ ] **Шаг 7: Проверить TypeScript**

```bash
cd maintenance-tracker
npx tsc --noEmit
```

Ожидаемый результат: нет ошибок.

- [ ] **Шаг 8: Запустить и проверить вручную**

```bash
npm run dev
```

**Проверка 1 — роли:**
- Войти как собственник → `/history` → убедиться что видна кнопка "Верифицировать" (не прочерк)
- Войти как НП → `/history` → убедиться что кнопки "Верифицировать" НЕТ, только прочерк или "Верифицировано"

**Проверка 2 — фото:**
- Войти как НП → `/checklist` → отметить задачу "Выполнено" → прикрепить фото → сохранить
- Войти как собственник → `/history` → найти запись → увидеть иконку фото → кликнуть → открылась модалка с фото
- В модалке нажать "Верифицировать" → запись изменилась на "✓ Верифицировано"
- Закрыть модалку (крестик, ESC, клик вне) — всё закрывается

- [ ] **Шаг 9: Commit**

```bash
git add app/history/HistoryClient.tsx app/history/page.tsx
git commit -m "feat: photo modal in history, fix verify role owner-only"
```

---

## Task 5: Финальная проверка и push

- [ ] **Шаг 1: Полный прогон TypeScript**

```bash
cd maintenance-tracker
npx tsc --noEmit
```

Ожидаемый результат: 0 ошибок.

- [ ] **Шаг 2: Проверить билд**

```bash
npm run build
```

Ожидаемый результат: успешный билд без ошибок. Предупреждения допустимы.

- [ ] **Шаг 3: Smoke test сценариев**

| Сценарий | Ожидаемый результат |
|----------|-------------------|
| НП: отметить "Выполнено" без фото | Сохраняется, в истории нет иконки фото |
| НП: отметить "Выполнено" с фото (>10MB) | Ошибка "Файл слишком большой" |
| НП: прикрепить фото, заменить, сохранить | В истории иконка фото, при клике — новое фото |
| НП: попытаться нажать "Верифицировать" | Кнопки нет, видит прочерк или "Верифицировано" |
| Собственник: клик на иконку фото → модалка | Фото открывается, кнопка "Верифицировать" |
| Собственник: верификация из модалки | Статус меняется на "Верифицировано" |
| ESC в открытой модалке | Модалка закрывается |
| Клик вне модалки | Модалка закрывается |

- [ ] **Шаг 4: Push ветки**

```bash
git push origin feature/photo-verification
```
