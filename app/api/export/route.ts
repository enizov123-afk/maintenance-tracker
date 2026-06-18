import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

const FREQ_LABELS: Record<string, string> = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  quarterly: 'Раз в 3 мес',
  biannual: 'Раз в 6 мес',
  annual: 'Раз в год',
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // Проверка аутентификации
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const dateFrom   = searchParams.get('dateFrom')
  const dateTo     = searchParams.get('dateTo')
  const equipment  = searchParams.get('equipment')
  const status     = searchParams.get('status')

  // Строим запрос с теми же фильтрами что в HistoryPage
  let query = supabase
    .from('maintenance_logs')
    .select(`
      *,
      maintenance_tasks(description, frequency, equipment_id,
        equipment(name)
      ),
      profiles(name)
    `)
    .order('performed_at', { ascending: false })

  if (dateFrom)  query = query.gte('performed_at', dateFrom)
  if (dateTo)    query = query.lte('performed_at', dateTo)
  if (status && status !== 'all') query = query.eq('status', status)

  const { data: logs, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Фильтр по оборудованию (клиентский — данные уже загружены)
  const filtered = equipment && equipment !== 'all'
    ? (logs ?? []).filter((log: any) => log.maintenance_tasks?.equipment_id === equipment)
    : (logs ?? [])

  // Формируем строки для Excel
  const rows = filtered.map((log: any) => ({
    'Дата':              log.performed_at,
    'Оборудование':      log.maintenance_tasks?.equipment?.name ?? '—',
    'Работа':            log.maintenance_tasks?.description ?? '—',
    'Периодичность':     FREQ_LABELS[log.maintenance_tasks?.frequency ?? ''] ?? '—',
    'Статус':            log.status === 'done' ? 'Выполнено' : 'Пропущено',
    'Примечание':        log.note ?? '',
    'Верифицировано':    log.verified ? 'Да' : 'Нет',
    'Кто отметил':       log.profiles?.name ?? '—',
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ 'Данные': 'Нет записей за выбранный период' }])

  // Ширина колонок
  ws['!cols'] = [
    { wch: 12 }, // Дата
    { wch: 30 }, // Оборудование
    { wch: 50 }, // Работа
    { wch: 16 }, // Периодичность
    { wch: 12 }, // Статус
    { wch: 30 }, // Примечание
    { wch: 14 }, // Верифицировано
    { wch: 25 }, // Кто отметил
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'История ТО')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const dateLabel = dateFrom ? `${dateFrom}` : 'all'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="history-${dateLabel}.xlsx"`,
    },
  })
}
