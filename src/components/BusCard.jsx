import { Bus, MapPin, Clock, ArrowRight } from 'lucide-react'

export default function BusCard({
  bus,
  currentStop,
  destination,
  onTrack,
  onViewDetails,
}) {
  const isApproaching = bus.tracking_status === 'APPROACHING'
  const isLive = Boolean(
    bus.tracking_status === 'LIVE' ||
      (bus.is_live && !isApproaching && bus.tracking_status !== 'LOCATION STALE' && bus.tracking_status !== 'OFFLINE')
  )
  const isStale = bus.tracking_status === 'LOCATION STALE'
  const isScheduled = bus.tracking_status === 'SCHEDULED' || (!isLive && !isApproaching && !isStale)
  const isNotTracking = bus.tracking_status === 'NOT TRACKING'
  const canTrack = isLive || isApproaching || isStale

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs hover:border-blue-400 hover:shadow-xs transition flex flex-col justify-between space-y-4 select-none">
      {/* Header Row: Operator Name, Vehicle Number, Service Type & Status Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
            <Bus size={22} strokeWidth={2.4} />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 leading-tight m-0">
              {bus.bus_name}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {bus.vehicle_number}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                • {bus.service_type || 'Non AC Express'}
              </span>
            </div>
          </div>
        </div>

        {/* Real Status Badge: LIVE, APPROACHING, SCHEDULED, LOCATION STALE */}
        {isApproaching ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-500 text-white shadow-2xs shrink-0 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-white" />
            APPROACHING
          </span>
        ) : isLive ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-800 border border-emerald-300 shrink-0 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            LIVE
          </span>
        ) : isStale ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-800 border border-amber-300 shrink-0">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            LOCATION STALE
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            SCHEDULED
          </span>
        )}
      </div>

      {/* Real-time Arrival Estimate & Category Strip */}
      <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-2.5 text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              bus.search_category === 'PRESENT'
                ? 'bg-emerald-500'
                : bus.search_category === 'APPROACHING'
                ? 'bg-amber-500'
                : bus.search_category === 'EN_ROUTE'
                ? 'bg-blue-500'
                : 'bg-slate-400'
            }`} />
            <span className="font-bold text-slate-700">
              {bus.search_category === 'PRESENT'
                ? 'Present at Stop'
                : bus.search_category === 'APPROACHING'
                ? 'Approaching Stop'
                : bus.search_category === 'EN_ROUTE'
                ? 'Travelling towards Stop'
                : 'Owner-Configured Schedule'}
            </span>
          </div>
          {bus.distance_to_stop_km !== null && bus.distance_to_stop_km !== undefined && (
            <span className="text-[11px] font-semibold text-slate-500">
              {bus.distance_to_stop_km === 0 ? 'At Platform' : `${bus.distance_to_stop_km} km away`}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
              <Clock size={11} className="text-emerald-600" />
              <span>Expected Arrival</span>
            </span>
            <strong className="text-base font-black text-slate-900 block mt-0.5 leading-tight">
              {bus.expected_arrival_time || bus.boarding_planned_time || '10:40 AM'}
            </strong>
            <span className="text-xs font-bold text-slate-700 block truncate max-w-[120px]">
              {bus.boarding_stop || currentStop}
            </span>
          </div>

          <div className="text-slate-400 flex flex-col items-center justify-center px-2">
            <ArrowRight size={18} strokeWidth={2.4} />
            <span className="text-[10px] font-semibold text-slate-500 mt-0.5">
              {bus.live_eta_minutes != null
                ? bus.live_eta_minutes === 0
                  ? 'At Stop'
                  : `in ${bus.live_eta_minutes}m`
                : 'Direct'}
            </span>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center justify-end gap-1">
              <Clock size={11} className="text-rose-600" />
              <span>Destination Arrival</span>
            </span>
            <strong className="text-base font-black text-slate-900 block mt-0.5 leading-tight">
              {bus.destination_planned_time || '12:15 PM'}
            </strong>
            <span className="text-xs font-bold text-slate-700 block truncate max-w-[120px]">
              {bus.destination_stop || destination}
            </span>
          </div>
        </div>

        {/* Schedule Adherence Comparison (Real GPS Progress vs Owner's Timetable) */}
        <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 truncate">
            {bus.schedule_adherence === 'DELAYED' ? (
              <span className="px-2 py-0.5 rounded font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                ⚠️ Delayed by {bus.delay_minutes}m (Sched: {bus.boarding_planned_time})
              </span>
            ) : bus.schedule_adherence === 'EARLY' ? (
              <span className="px-2 py-0.5 rounded font-extrabold bg-blue-100 text-blue-800 border border-blue-300">
                ⚡ Running {Math.abs(bus.delay_minutes)}m early (Sched: {bus.boarding_planned_time})
              </span>
            ) : bus.is_live || isApproaching ? (
              <span className="px-2 py-0.5 rounded font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                ✓ On Time (Sched: {bus.boarding_planned_time})
              </span>
            ) : (
              <span className="text-slate-500 font-semibold">
                Owner Timetable: {bus.boarding_planned_time}
              </span>
            )}
          </div>

          {bus.last_update && (
            <span className="text-slate-400 font-mono text-[10px] shrink-0 ml-2">
              GPS {bus.last_update} IST
            </span>
          )}
        </div>
      </div>

      {/* Assigned Conductor Details */}
      {bus.conductor_name && (
        <div className="text-xs text-slate-600 font-medium bg-white p-2.5 rounded-lg border border-slate-100 flex items-center justify-between">
          <span className="truncate">
            <strong className="text-slate-800">Conductor:</strong> {bus.conductor_name}
          </span>
          <span className="text-slate-500 text-[11px] font-semibold shrink-0">
            {bus.conductor_phone || 'Onboard'}
          </span>
        </div>
      )}

      {/* Action Buttons: Clearly Labelled Track Bus and View Details */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        {canTrack ? (
          <>
            <button
              type="button"
              onClick={() => onTrack(bus)}
              className="min-h-[44px] py-2.5 px-3 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-black text-xs sm:text-sm rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <MapPin size={16} strokeWidth={2.4} className="shrink-0" />
              <span>Track Bus</span>
            </button>

            <button
              type="button"
              onClick={() => onViewDetails(bus)}
              className="min-h-[44px] py-2.5 px-3 bg-white border border-slate-300 hover:bg-slate-50 active:scale-98 text-slate-900 font-black text-xs sm:text-sm rounded-xl transition cursor-pointer flex items-center justify-center"
            >
              View Details
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onViewDetails(bus)}
              className="col-span-2 min-h-[44px] py-2.5 px-3 bg-white border border-slate-300 hover:bg-slate-50 hover:border-blue-400 active:scale-98 text-slate-900 font-black text-xs sm:text-sm rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
            >
              <span>View Details &amp; Stop Timetable</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
