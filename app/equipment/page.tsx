import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import Navigation from '@/components/Navigation'
import { type Equipment, type MaintenanceTask, type MaintenanceLog, type Profile } from '@/lib/types'
import EquipmentTable from './EquipmentTable'

export default async function EquipmentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const { data: equipment } = await supabase.from('equipment').select('*').order('sort_order')
  const { data: tasks } = await supabase.from('maintenance_tasks').select('*').eq('is_active', true)
  const { data: logs } = await supabase.from('latest_done_logs').select('*')

  return (
    <div className="min-h-screen md:flex">
      <Navigation profile={profile as Profile} />
      <main className="flex-1 p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Оборудование</h1>
          <p className="text-sm text-gray-500 mt-1">Полный перечень и статус ТО</p>
        </div>
        <EquipmentTable
          equipmentList={(equipment as Equipment[]) || []}
          taskList={(tasks as MaintenanceTask[]) || []}
          logList={(logs as MaintenanceLog[]) || []}
        />
      </main>
    </div>
  )
}
