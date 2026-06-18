export default function ChecklistLoading() {
  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar skeleton */}
      <div className="hidden md:flex md:w-56 bg-white border-r border-gray-200 flex-col p-4 gap-2">
        <div className="h-8 bg-gray-100 rounded-lg animate-pulse mb-4" />
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
      {/* Main skeleton */}
      <main className="flex-1 p-4 sm:p-6">
        <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse mb-2" />
        <div className="h-4 w-64 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 animate-pulse">
              <div className="h-5 w-40 bg-gray-100 rounded" />
              <div className="h-4 w-full bg-gray-100 rounded" />
              <div className="h-4 w-3/4 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
