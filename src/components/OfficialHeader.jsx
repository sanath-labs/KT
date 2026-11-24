import { Menu, Bus, Clock } from 'lucide-react'
import { useSynchronizedClock } from '../istClockService.js'

export default function OfficialHeader({
  role = 'passenger',
  onOpenDrawer,
  onNavigateHome,
  lang = 'en',
  toggleLanguage,
  dbStatus = true,
}) {
  const clock = useSynchronizedClock(1000)
  return (
    <header className="w-full bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
        {/* Left: Hamburger Button & Official Brand Logo */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenDrawer}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-700 hover:text-blue-600 hover:bg-slate-100 active:scale-95 transition cursor-pointer"
            aria-label="Open Navigation Menu"
            title="Open Navigation Menu"
          >
            <Menu size={22} strokeWidth={2.4} />
          </button>

          <div
            onClick={onNavigateHome}
            className="flex items-center gap-2.5 cursor-pointer"
            title="Karavali-Transit Home"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Bus size={19} strokeWidth={2.4} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-900 leading-none">
                  Karavali-Transit
                </span>
                <span className="hidden md:inline-flex px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  {role === 'owner'
                    ? 'Fleet Owner Portal'
                    : role === 'conductor'
                    ? 'Conductor Terminal'
                    : 'Public Transit Network'}
                </span>
              </div>
              <p className="text-[11px] font-semibold text-slate-500 leading-tight hidden sm:block mt-0.5">
                Coastal Karnataka NH-66 Corridor
              </p>
            </div>
          </div>
        </div>

        {/* Middle/Right: Real-Time Live IST Clock & Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-900 text-white shadow-2xs border border-slate-800"
            title={`Indian Standard Time (Asia/Kolkata UTC+05:30) • ${
              clock.isSynchronized ? 'Synchronized with Backend Clock' : 'Syncing with Server…'
            }`}
          >
            <div className="relative flex items-center justify-center">
              <Clock size={14} className="text-amber-400 shrink-0" />
              <span
                className={`absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full ${
                  clock.isSynchronized ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
            </div>

            <div className="flex flex-col text-left">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-mono font-black text-xs sm:text-sm tracking-tight text-white">
                  {clock.istTime}
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 bg-amber-950/80 px-1 py-0.2 rounded border border-amber-800/60">
                  IST
                </span>
              </div>
              <span className="text-[10px] font-semibold text-slate-400 leading-tight hidden xl:inline">
                {clock.istDate || 'Asia/Kolkata (UTC+05:30)'}
              </span>
            </div>
          </div>

          <div className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${dbStatus ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
            <span className={`w-2 h-2 rounded-full ${dbStatus ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span>{dbStatus ? 'Network Connected' : 'Network Unavailable'}</span>
          </div>

          <button
            type="button"
            onClick={toggleLanguage}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-600 bg-slate-50 hover:bg-blue-50 text-slate-800 font-extrabold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
            title={lang === 'en' ? 'ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಿ' : 'Switch to English'}
          >
            <span className="text-sm">🌐</span>
            <span>{lang === 'en' ? 'ಕನ್ನಡ' : 'English'}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
