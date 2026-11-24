import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env?.SUPABASE_URL) ||
  ''

const supabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env?.SUPABASE_ANON_KEY) ||
  ''

let supabase = null

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

export function getSupabaseClient() {
  if (!supabase && isSupabaseConfigured()) {
    try {
      supabase = createClient(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      })
    } catch (err) {
      console.warn('[Supabase] Failed to initialize client:', err.message)
    }
  }
  return supabase
}

/**
 * Subscribes to Realtime bus GPS telemetry updates using Supabase Realtime.
 *
 * @param {Function} onTelemetryReceived - Callback when live GPS update arrives
 * @returns {Function} Unsubscribe cleanup function
 */
export function subscribeToRealtimeBusTracking(onTelemetryReceived) {
  const client = getSupabaseClient()
  if (!client) {
    return () => {}
  }

  try {
    const channel = client
      .channel('karavali_bus_tracking')
      .on('broadcast', { event: 'bus_location_update' }, (payload) => {
        if (payload?.payload && typeof onTelemetryReceived === 'function') {
          onTelemetryReceived(payload.payload)
        }
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gps_telemetry' },
        (payload) => {
          if (payload?.new && typeof onTelemetryReceived === 'function') {
            onTelemetryReceived(payload.new)
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Channel active
        }
      })

    return () => {
      client.removeChannel(channel)
    }
  } catch (err) {
    console.warn('[Supabase Realtime] Subscription error:', err.message)
    return () => {}
  }
}

/**
 * Broadcasts bus location update via Supabase Realtime channel.
 */
export async function broadcastBusLocation(telemetry) {
  const client = getSupabaseClient()
  if (!client || !telemetry) return

  try {
    const channel = client.channel('karavali_bus_tracking')
    await channel.send({
      type: 'broadcast',
      event: 'bus_location_update',
      payload: telemetry,
    })
  } catch (err) {
    console.warn('[Supabase Realtime] Broadcast error:', err.message)
  }
}
