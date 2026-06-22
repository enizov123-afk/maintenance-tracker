export type Role = 'owner' | 'production_manager'

export type EquipmentStatus = 'active' | 'maintenance' | 'decommissioned'

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual'

export type LogStatus = 'done' | 'skipped'

export type TaskStatus = 'ok' | 'due_soon' | 'overdue'

export interface Profile {
  id: string
  name: string
  role: Role
  created_at: string
}

export interface Equipment {
  id: string
  name: string
  model: string | null
  status: EquipmentStatus
  sort_order: number
  created_at: string
}

export interface MaintenanceTask {
  id: string
  equipment_id: string
  description: string
  frequency: Frequency
  assignee_role: string
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface MaintenanceLog {
  id: string
  task_id: string
  performed_at: string
  performed_by: string | null
  status: LogStatus
  note: string | null
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  photo_url: string | null
  created_at: string
}

export interface TaskWithLog extends MaintenanceTask {
  last_log: MaintenanceLog | null
  task_status: TaskStatus
  next_due: Date
}

export interface EquipmentWithStatus extends Equipment {
  overdue_count: number
  due_soon_count: number
  overall_status: TaskStatus
}

// Количество дней для каждой периодичности
export const FREQUENCY_DAYS: Record<Frequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  biannual: 180,
  annual: 365,
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  quarterly: 'Раз в 3 месяца',
  biannual: 'Раз в 6 месяцев',
  annual: 'Раз в год',
}

export const ROLE_LABELS: Record<string, string> = {
  operator: 'Оператор',
  mechanic: 'Механик',
  electrician: 'Электрик',
  contractor: 'Подрядчик',
}

export const STATUS_LABELS: Record<EquipmentStatus, string> = {
  active: 'Активно',
  maintenance: 'На ремонте',
  decommissioned: 'Выведено',
}

/**
 * Парсит строку даты "YYYY-MM-DD" как локальную дату (без UTC-сдвига).
 * new Date("2026-06-18") трактует как UTC midnight — в UTC+3 это
 * 21:00 предыдущего дня, что ломает сравнения статусов. (BUG-03)
 */
export function parseDateLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Вычисляет статус задачи на основе последнего лога
 */
export function calcTaskStatus(
  frequency: Frequency,
  lastLog: MaintenanceLog | null
): { status: TaskStatus; nextDue: Date } {
  const days = FREQUENCY_DAYS[frequency]
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  if (!lastLog) {
    // Никогда не выполнялась — считаем просроченной
    return { status: 'overdue', nextDue: now }
  }

  // Используем локальный парсинг дат — без UTC-сдвига (BUG-03)
  const lastDate = parseDateLocal(lastLog.performed_at)

  const nextDue = new Date(lastDate)
  nextDue.setDate(nextDue.getDate() + days)

  const diffDays = Math.floor((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { status: 'overdue', nextDue }
  if (diffDays <= 3) return { status: 'due_soon', nextDue }
  return { status: 'ok', nextDue }
}
