interface PlaceholderPageProps {
  title: string
  module: string
  moduleColor: 'emerald' | 'blue' | 'violet'
  description?: string
}

const colorMap = {
  emerald: {
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    border: 'border-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  blue: {
    badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    border: 'border-blue-500/20',
    dot: 'bg-blue-400',
  },
  violet: {
    badge: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    border: 'border-violet-500/20',
    dot: 'bg-violet-400',
  },
}

export default function PlaceholderPage({ title, module, moduleColor, description }: PlaceholderPageProps) {
  const colors = colorMap[moduleColor]
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colors.badge}`}>
              {module}
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-white">{title}</h1>
          {description && <p className="text-gray-500 text-sm mt-1">{description}</p>}
        </div>
      </div>

      <div className={`rounded-xl border ${colors.border} bg-gray-900 p-12 flex flex-col items-center justify-center text-center`}>
        <div className={`w-3 h-3 rounded-full ${colors.dot} mb-4 opacity-60`} />
        <p className="text-gray-400 font-medium">This page is under construction</p>
        <p className="text-gray-600 text-sm mt-1">Content for <span className="text-gray-500">{title}</span> will appear here.</p>
      </div>
    </div>
  )
}
