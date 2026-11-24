import { useState, useEffect } from 'react'
import { apiUrl, socketUrl } from './api.js'
import { getISTDateTime } from './transitUtils.js'
import io from 'socket.io-client'

// Module-level clock synchronization state
let clockSkewMs = 0
let isSynchronized = false
let lastSyncTimestamp = 0
let syncListeners = new Set()
let sharedSocket = null

function notifyListeners() {
  syncListeners.forEach((fn) => {
    try {
      fn({ isSynchronized, clockSkewMs, lastSyncTimestamp })
    } catch {}
  })
}

/**
 * Perform a high-accuracy clock synchronization handshake with backend server
 */
export async function syncClockWithBackend() {
  const startClientMs = Date.now()
  try {
    const res = await fetch(apiUrl('/api/time'), { cache: 'no-store' })
    const endClientMs = Date.now()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    if (typeof data.server_time_ms === 'number') {
      const rtt = Math.max(0, endClientMs - startClientMs)
      // Estimated true server time at endClientMs = server_time_ms + rtt / 2
      const estimatedServerNow = data.server_time_ms + Math.round(rtt / 2)
      clockSkewMs = estimatedServerNow - endClientMs
      isSynchronized = true
      lastSyncTimestamp = endClientMs
      notifyListeners()
      return { success: true, skewMs: clockSkewMs, rtt }
    }
  } catch (err) {
    console.warn('[ClockSync] Failed to fetch server clock, using local clock fallback:', err.message)
  }
  return { success: false, skewMs: clockSkewMs }
}

/**
 * Initialize WebSocket clock sync listener
 */
export function initSocketClockSync(customSocket) {
  const s = customSocket || sharedSocket || io(socketUrl)
  if (!sharedSocket && !customSocket) {
    sharedSocket = s
  }

  s.on('clock_sync', (data) => {
    if (data && typeof data.server_time_ms === 'number') {
      const now = Date.now()
      clockSkewMs = data.server_time_ms - now
      isSynchronized = true
      lastSyncTimestamp = now
      notifyListeners()
    }
  })

  s.on('clock_sync_response', (data) => {
    if (data && typeof data.server_time_ms === 'number' && typeof data.client_send_ms === 'number') {
      const now = Date.now()
      const rtt = Math.max(0, now - data.client_send_ms)
      const estimatedServerNow = data.server_time_ms + Math.round(rtt / 2)
      clockSkewMs = estimatedServerNow - now
      isSynchronized = true
      lastSyncTimestamp = now
      notifyListeners()
    }
  })

  // Perform initial sync request
  syncClockWithBackend()
}

// Automatically initiate sync on module load
if (typeof window !== 'undefined') {
  syncClockWithBackend()
  // Re-sync every 60 seconds to eliminate long-term drift
  setInterval(() => {
    syncClockWithBackend()
  }, 60000)
}

/**
 * Get current server timestamp in milliseconds (immune to client device clock errors)
 */
export function getSynchronizedServerTimeMs() {
  return Date.now() + clockSkewMs
}

/**
 * Get current synchronized Indian Standard Time (IST - Asia/Kolkata UTC+05:30)
 */
export function getSynchronizedIST() {
  return getISTDateTime(getSynchronizedServerTimeMs())
}

/**
 * React hook for live synchronized IST clock display across portals
 *
 * @param {number} [intervalMs=1000] Refresh interval
 * @returns {Object} Synchronized IST details
 */
export function useSynchronizedClock(intervalMs = 1000) {
  const [clockData, setClockData] = useState(() => {
    const ist = getSynchronizedIST()
    return {
      serverTimeMs: getSynchronizedServerTimeMs(),
      istTime: ist?.formatted_time || '10:00:00 AM',
      istTimeShort: ist?.formatted_time_short || '10:00 AM',
      istDate: ist?.formatted_date || '',
      istDateTime: ist?.formatted_date_time || '',
      minutesSinceMidnight: ist?.minutes_since_midnight || 600,
      weekday: ist?.weekday || '',
      day: ist?.day || '',
      month: ist?.month || '',
      year: ist?.year || '',
      hour: ist?.hour || 0,
      minute: ist?.minute || 0,
      second: ist?.second || 0,
      meridian: ist?.meridian || 'AM',
      isSynchronized,
      clockSkewMs,
    }
  })

  useEffect(() => {
    const update = () => {
      const ist = getSynchronizedIST()
      setClockData({
        serverTimeMs: getSynchronizedServerTimeMs(),
        istTime: ist?.formatted_time || '10:00:00 AM',
        istTimeShort: ist?.formatted_time_short || '10:00 AM',
        istDate: ist?.formatted_date || '',
        istDateTime: ist?.formatted_date_time || '',
        minutesSinceMidnight: ist?.minutes_since_midnight || 600,
        weekday: ist?.weekday || '',
        day: ist?.day || '',
        month: ist?.month || '',
        year: ist?.year || '',
        hour: ist?.hour || 0,
        minute: ist?.minute || 0,
        second: ist?.second || 0,
        meridian: ist?.meridian || 'AM',
        isSynchronized,
        clockSkewMs,
      })
    }

    const timer = setInterval(update, intervalMs)
    const listener = () => update()
    syncListeners.add(listener)

    return () => {
      clearInterval(timer)
      syncListeners.delete(listener)
    }
  }, [intervalMs])

  return clockData
}
