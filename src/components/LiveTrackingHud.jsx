import { useState } from 'react'
import { Bus, Clock, AlertCircle, Compass, Gauge, Shield, ChevronDown, ChevronUp, MapPin } from 'lucide-react'
import { formatToIST, OFFICIAL_9_CORRIDOR_STOPS } from '../transitUtils.js'

export default function LiveTrackingHud({
  bus,
  telemetry,
  status = 'OFFLINE',
  secondsAgo = 0,
  nextStop = '',
  journeyInfo = null,
  roadProgress = null,
}) {
  const [showMilestones, setShowMilestones] = useState(false)

  if (!bus) return null

  // Compute display status: LIVE, GPS WEAK, LOCATION STALE, OFFLINE
  const rawStatus = (
    telemetry?.tracking_status ||
    status ||
    (telemetry?.latitude && telemetry?.longitude ? 'LIVE' : 'NOT TRACKING')
  ).toUpperCase()

  const isGpsWeak = roadProgress?.accuracyStatus === 'GPS_WEAK' || (telemetry?.accuracy && telemetry.accuracy > 70)
  const isStale = rawStatus === 'LOCATION STALE' || secondsAgo > 120
  const isLive = !isStale && (rawStatus === 'LIVE' || (telemetry?.latitude && telemetry?.longitude))
  const isOffline = !isLive && !isStale

  let statusBadge = {
    label: 'LIVE',
    color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    dot: 'bg-emerald-500 animate-pulse',
  }

  if (isGpsWeak && isLive) {
    statusBadge = {
      label: 'GPS WEAK',
      color: 'bg-amber-50 text-amber-800 border-amber-300',
      dot: 'bg-amber-500',
    }
  } else if (isStale) {
    statusBadge = {
      label: 'LOCATION STALE',
      color: 'bg-orange-50 text-orange-800 border-orange-300',
      dot: 'bg-orange-500',
    }
  } else if (isOffline) {
    statusBadge = {
      label: 'SCHEDULED',
      color: 'bg-slate-100 text-slate-700 border-slate-200',
      dot: 'bg-slate-400',
    }
  }

  const telemetryIstTime =
    telemetry?.timestamp_ist ||
    (telemetry?.timestamp ? formatToIST(telemetry.timestamp, 'time-only') : null)

  const currentSpeed = Math.round(Number(telemetry?.speed) || 0)
  const accuracyMeters = Math.round(Number(telemetry?.accuracy) || 0)

  // Destination and next stop details
  const displayNextStop = roadProgress?.nextStop || nextStop || journeyInfo?.to || bus.destination || 'Kundapura'
  const distToNextKm = roadProgress?.distanceToNextStopKm || 0
  const roadName = roadProgress?.roadName || 'NH-66 Coastal Highway'
  const directionStr = roadProgress?.directionOfTravel || 'Northbound (Towards Kundapura)'

  // Live ETA vs Owner-scheduled fallback
  const isLiveEta = isLive && roadProgress?.etaMinutesToTarget
  const etaDisplay = isLiveEta
    ? `${roadProgress.etaMinutesToTarget} mins (${roadProgress.distanceToTargetKm} km)`
    : bus.destination_planned_time || 'On schedule'

  return (
    <div className="absolute bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:w-[440px] z-10 select-none">
      <div className="bg-white/98 backdrop-blur-md rounded-2xl p-4 sm:p-5 shadow-2xl border border-slate-200/90 space-y-3.5 transition-all">
        {/* Header: Bus Name, Registration Number & Live Status Badge */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 shadow-2xs">
              <Bus size={20} strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black text-slate-900 leading-tight m-0 truncate">
                {bus.bus_name}
              </h3>
              <p className="text-xs font-mono font-bold text-slate-600 m-0 mt-0.5 truncate">
                {bus.vehicle_number}
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border shadow-2xs shrink-0 ${statusBadge.color}`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${statusBadge.dot}`} />
            <span>{statusBadge.label}</span>
          </span>
        </div>

        {/* Real-time Highway & Direction Strip */}
        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-1.5 truncate">
            <Compass size={13} className="text-blue-600 shrink-0" />
            <span className="font-semibold truncate">{roadName}</span>
          </div>
          <span className="text-[11px] font-bold text-slate-500 shrink-0">
            {directionStr.split(' ')[0]}
          </span>
        </div>

        {/* 2-Column KPI Card: Next Stop & Road-Calculated ETA */}
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          {/* Next Corridor Stop */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">
              Next Stop
            </span>
            <strong className="text-sm font-black text-slate-900 mt-1 block truncate">
              {displayNextStop}
            </strong>
            {distToNextKm > 0 && (
              <span className="text-[11px] font-bold text-blue-700 block mt-0.5">
                {distToNextKm} km remaining
              </span>
            )}
          </div>

          {/* Road Distance & Arrival Calculation */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                Arrival ETA
              </span>
              <span
                className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                  isLiveEta
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {isLiveEta ? 'LIVE ETA' : 'TIMETABLE'}
              </span>
            </div>
            <strong className="text-sm font-black text-slate-900 mt-1 block truncate">
              {etaDisplay}
            </strong>
            <span className="text-[11px] text-slate-500 block mt-0.5 truncate">
              To {journeyInfo?.to || bus.destination || 'Kundapura'}
            </span>
          </div>
        </div>

        {/* GPS Sensor Telemetry Strip: Speed, Satellite Accuracy, Freshness */}
        {isLive && (
          <div className="grid grid-cols-3 gap-2 text-[11px] font-semibold text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
            <div className="flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
                <Gauge size={10} className="text-blue-600" /> Speed
              </span>
              <strong className="text-slate-900 mt-0.5">{currentSpeed} km/h</strong>
            </div>

            <div className="flex flex-col items-center border-x border-slate-200 px-1">
              <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
                <Shield size={10} className="text-emerald-600" /> GPS Precision
              </span>
              <strong className="text-slate-900 mt-0.5">
                {accuracyMeters > 0 ? `±${accuracyMeters}m` : 'High fix'}
              </strong>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
                <Clock size={10} className="text-slate-500" /> Freshness
              </span>
              <strong className="text-slate-900 mt-0.5">
                {secondsAgo <= 5 ? 'Just now' : `${secondsAgo}s ago`}
              </strong>
            </div>
          </div>
        )}

        {/* Collapsible NH-66 Corridor Progress Button */}
        <div>
          <button
            type="button"
            onClick={() => setShowMilestones((prev) => !prev)}
            className="w-full text-xs font-bold text-slate-600 hover:text-blue-600 flex items-center justify-between py-1 transition cursor-pointer"
          >
            <span>Corridor Stop Milestones (9 Stops)</span>
            {showMilestones ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showMilestones && (
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1 overflow-x-auto pb-1 text-[10px]">
              {OFFICIAL_9_CORRIDOR_STOPS.map((s, idx) => {
                const isCurrentNext = s.stop_name.toLowerCase() === displayNextStop.toLowerCase()
                return (
                  <div
                    key={s.stop_id}
                    className={`flex flex-col items-center shrink-0 min-w-[42px] text-center ${
                      isCurrentNext ? 'text-blue-600 font-black' : 'text-slate-500 font-medium'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black mb-0.5 ${
                        isCurrentNext
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {idx + 1}
                    </div>
                    <span className="truncate max-w-[46px]">{s.stop_name}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer Status Message with Real IST Timestamp */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-medium text-slate-500">
          <div className="flex items-center gap-1.5 truncate">
            {isLive ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="truncate text-emerald-800 font-bold">
                  Conductor GPS Active on NH-66
                </span>
              </>
            ) : isStale ? (
              <>
                <Clock size={12} className="text-amber-600 shrink-0" />
                <span className="truncate text-amber-800 font-bold">
                  Signal Delayed • Showing Last Position
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={12} className="text-slate-400 shrink-0" />
                <span className="truncate">GPS Idle • Showing Official Timetable</span>
              </>
            )}
          </div>
          {telemetryIstTime && (
            <span className="font-mono text-[10px] text-slate-400 shrink-0">
              {telemetryIstTime} IST
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
