import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import Navigation from '@/components/Navigation'
import HistoryClient from './HistoryClient'
import type { Equipment, Profile } from '@/lib/types'

interface SearchParams {
  dateFrom?: string
  dateTo?: string
  equipment?: string
  status?: string
  page?: string
}

const PAGE_SIZE = 100

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const { data: equipment } = await supabase.from('equipment').select('*').order('sort_order')

  const page = Math.max(0, Number(searchParams.page ?? 0))
  const dateFrom = searchParams.dateFrom || null
  const dateTo = searchParams.dateTo || null

  // Серверная фильтрация по дате — устраняет hardcoded limit(200) (BUG-07, D1)
  let query = supabase
    .from('maintenance_logs')
    .select(`
      *,
      maintenance_tasks(description, frequency, equipment_id),
      profiles!performed_by(name)
    `, { count: 'exact' })
    .order('performed_at', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

  if (dateFrom) query = query.gte('performed_at', dateFrom)
  if (dateTo)   query = query.lte('performed_at', dateTo)

  const { data: logs, count } = await query
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="min-h-screen md:flex">
      <Navigation profile={profile as Profile} />
      <main className="flex-1 p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">История работ</h1>
          <p className="text-sm text-gray-500 mt-1">Журнал выполненных и пропущенных регламентов</p>
        </div>

        <HistoryClient
          logs={logs || []}
          equipment={equipment as Equipment[] || []}
          isPM={profile.role === 'production_manager'}
          userId={user.id}
          totalCount={count ?? 0}
          currentPage={page}
          totalPages={totalPages}
          initialDateFrom={dateFrom}
          initialDateTo={dateTo}
        />
      </main>
    </div>
  )
}
