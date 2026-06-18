import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import Navigation from '@/components/Navigation'
import type { Profile } from '@/lib/types'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return (
    <div className="flex min-h-screen">
      <Navigation profile={profile as Profile} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
