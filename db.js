import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import pg from 'pg'

const require = createRequire(import.meta.url)

// Ensure PostgreSQL timestamps without timezone are parsed as UTC
pg.types.setTypeParser(1114, (str) => {
  if (!str) return null
  const iso = str.includes('T') ? (str.endsWith('Z') ? str : `${str}Z`) : `${str.replace(' ', 'T')}Z`
  return new Date(iso)
})
import { matchesConductorPin } from './serverAuth.js'
import {
  parseTimeToMinutes,
  formatMinutesToTime,
  getCurrentMinutesIST,
  calculateLiveBusProgressAndEta,
  calculateScheduleAdherence,
  formatToIST,
  getISTDateTime,
} from './src/transitUtils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, 'transit.db')

// SQLite Instance (Lazy loaded to prevent uncloneable C++ handles and Linux GLIBC mismatches in cloud environments)
let _sqliteDb = null
let _sqlite3Module = null

export function getSqliteDb() {
  if (!_sqliteDb) {
    try {
      if (!_sqlite3Module) {
        _sqlite3Module = require('sqlite3')
      }
      _sqliteDb = new _sqlite3Module.Database(dbPath, (err) => {
        if (err) console.error('❌ Could not connect to SQLite database:', err.message)
        else {
          _sqliteDb.configure('busyTimeout', 15000)
          _sqliteDb.run('PRAGMA busy_timeout = 15000;')
          _sqliteDb.run('PRAGMA journal_mode = WAL;')
        }
      })
      try {
        _sqliteDb.configure('busyTimeout', 15000)
      } catch {}
    } catch (loadErr) {
      console.warn('⚠️ SQLite driver not loaded (safe fallback for PostgreSQL cloud deployments):', loadErr.message)
      const findCb = (args) => {
        for (let i = args.length - 1; i >= 0; i--) {
          if (typeof args[i] === 'function') return args[i]
        }
        return null
      }
      _sqliteDb = {
        run: (...args) => {
          const cb = findCb(args)
          if (cb) cb(null)
          return _sqliteDb
        },
        all: (...args) => {
          const cb = findCb(args)
          if (cb) cb(null, [])
          return _sqliteDb
        },
        get: (...args) => {
          const cb = findCb(args)
          if (cb) cb(null, null)
          return _sqliteDb
        },
        serialize: (fn) => fn && fn(),
        configure: () => {},
      }
    }
  }
  return _sqliteDb
}

export const sqliteDb = {
  run(...args) { return getSqliteDb().run(...args) },
  all(...args) { return getSqliteDb().all(...args) },
  get(...args) { return getSqliteDb().get(...args) },
  serialize(...args) { return getSqliteDb().serialize(...args) },
  prepare(...args) { return getSqliteDb().prepare(...args) },
}
export const db = sqliteDb // Backward compatibility alias

// PostgreSQL Pool (External / Local service)
const pgPoolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_URL.includes('localhost') ||
        process.env.DATABASE_URL.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: String(process.env.PGPASSWORD || ''),
      database: process.env.PGDATABASE || 'karavali_transit',
      max: 10,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true,
    }

const pgPool = new pg.Pool(pgPoolConfig)

let isConnected = false
let activeEngine = 'sqlite' // 'postgres' | 'sqlite'

export function isDbConnected() {
  return isConnected
}

const usePostgres =
  process.env.USE_POSTGRES === 'true' ||
  Boolean(process.env.DATABASE_URL) ||
  Boolean(process.env.POSTGRES_URL)

export function getDatabaseType() {
  if (activeEngine === 'postgres') {
    if (process.env.DATABASE_URL) {
      try {
        const u = new URL(process.env.DATABASE_URL)
        return `PostgreSQL Cloud (${u.host}${u.pathname})`
      } catch {
        return 'PostgreSQL Cloud (DATABASE_URL)'
      }
    }
    return `PostgreSQL (${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432} / ${process.env.PGDATABASE || 'karavali_transit'})`
  }
  return 'SQL (SQLite transit.db)'
}

export function isPostgres() {
  return activeEngine === 'postgres'
}

// Initialize Database Schema & Seed Initial Buses
let initDbPromise = null
export async function initDB() {
  if (initDbPromise) return initDbPromise
  initDbPromise = (async () => {
    if (usePostgres) {
      try {
        const client = await pgPool.connect()
        await client.query('SELECT 1')
        client.release()
        activeEngine = 'postgres'
        isConnected = true
        console.log(`✅ SQL Database connected: ${getDatabaseType()}`)
        await initPostgresSchema()
        return true
      } catch (err) {
        console.error('❌ Failed to connect to configured PostgreSQL database:', err.message)
        throw err
      }
    }

    // SQLite Initialization
    activeEngine = 'sqlite'
    return initSqliteSchema()
  })()
  return initDbPromise
}

// ============================================================================
// POSTGRESQL SCHEMA INITIALIZATION
// ============================================================================
async function initPostgresSchema() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS buses (
      bus_id SERIAL PRIMARY KEY,
      bus_name TEXT NOT NULL,
      vehicle_number TEXT NOT NULL UNIQUE,
      route_number TEXT NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'Express',
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      is_last_bus INTEGER DEFAULT 0,
      conductor_pin TEXT,
      owner_email TEXT DEFAULT 'vishal@gmail.com',
      total_seats INTEGER DEFAULT 45,
      photo_url TEXT,
      departure_time TEXT,
      frequency TEXT DEFAULT 'Daily',
      journey_duration TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS driver_shifts (
      shift_id SERIAL PRIMARY KEY,
      driver_phone TEXT NOT NULL,
      vehicle_number TEXT NOT NULL,
      bus_name TEXT NOT NULL,
      route_name TEXT NOT NULL,
      start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      end_time TIMESTAMP,
      status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS gps_telemetry (
      log_id SERIAL PRIMARY KEY,
      bus_id INTEGER,
      bus_name TEXT,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      speed INTEGER DEFAULT 0,
      delay_minutes INTEGER DEFAULT 0,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS owners (
      owner_id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      agency_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_otps (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      otp_code TEXT,
      otp_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      attempts INTEGER DEFAULT 0,
      used INTEGER DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(email, used);
    ALTER TABLE email_otps ADD COLUMN IF NOT EXISTS otp_hash TEXT;
    ALTER TABLE email_otps ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
    ALTER TABLE email_otps ADD COLUMN IF NOT EXISTS created_at BIGINT DEFAULT 0;

    CREATE TABLE IF NOT EXISTS bus_route_stops (
      id SERIAL PRIMARY KEY,
      bus_id INTEGER NOT NULL REFERENCES buses(bus_id) ON DELETE CASCADE,
      stop_order INTEGER NOT NULL,
      stop_name TEXT NOT NULL,
      planned_arrival TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conductors (
      conductor_id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      assigned_bus_id INTEGER REFERENCES buses(bus_id) ON DELETE SET NULL,
      status TEXT DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS owner_activities (
      activity_id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bus_stops (
      stop_id SERIAL PRIMARY KEY,
      stop_name TEXT NOT NULL UNIQUE,
      stop_name_kn TEXT NOT NULL,
      alternative_names TEXT NOT NULL,
      nearby_landmarks TEXT NOT NULL,
      locality TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS passenger_feedback (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      category TEXT DEFAULT 'General',
      rating INTEGER DEFAULT 5,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Check seed buses
  const countRes = await pgPool.query('SELECT COUNT(*) AS count FROM buses')
  if (Number(countRes.rows[0].count) === 0) {
    const seedBuses = [
      ['Vishal Express', 'KA-19-AB-4509', '15', 'Express', 'Mangaluru', 'Surathkal', 0, '4509', 'vishal@gmail.com', 45, '06:30 AM', 'Daily', '35 minutes'],
      ['Canara Pinto Deluxe', 'KA-20-C-8812', 'NH-66', 'Express', 'Mangaluru', 'Udupi', 0, '8812', 'vishal@gmail.com', 50, '07:15 AM', 'Daily', '1 hour 45 minutes'],
      ['Padmambika Local', 'KA-19-F-3304', '21', 'City / Ordinary', 'Mangaluru', 'Kuloor', 1, '3304', 'vishal@gmail.com', 40, '08:00 AM', 'Daily', '30 minutes']
    ]

    for (const b of seedBuses) {
      const ins = await pgPool.query(
        `INSERT INTO buses (bus_name, vehicle_number, route_number, service_type, origin, destination, is_last_bus, conductor_pin, owner_email, total_seats, departure_time, frequency, journey_duration)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING bus_id`,
        b
      )
      const busId = ins.rows[0].bus_id
      await pgPool.query(
        `INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES
         ($1, 1, 'Mangaluru', '06:30 AM'),
         ($1, 2, 'Surathkal', '07:05 AM'),
         ($1, 3, 'Kundapura', '09:00 AM'),
         ($1, 4, 'Udupi', '10:00 AM')`,
        [busId]
      )
    }
  }

  // Seed owners
  await pgPool.query(`
    INSERT INTO owners (email, agency_name) VALUES ('vishal@gmail.com', 'Vishal Coastal Travels') ON CONFLICT (email) DO NOTHING;
    INSERT INTO owners (email, agency_name) VALUES ('rakesh@gmail.com', 'Rakesh Shetty Travels') ON CONFLICT (email) DO NOTHING;
  `)

  await seedRakeshFleetPg()
  await seedVerifiedBusStopsPg()

  console.log('✅ PostgreSQL Database initialized (tables: buses, driver_shifts, gps_telemetry, owners, email_otps, bus_route_stops, conductors, owner_activities, bus_stops, passenger_feedback)')
  return true
}

async function seedRakeshFleetPg() {
  try {
    const rakeshBuses = [
      {
        bus_name: 'Shri Durga Travels',
        vehicle_number: 'KA 19 AB 1234',
        route_number: '001',
        service_type: 'Non AC',
        origin: 'Mangaluru',
        destination: 'Kundapura',
        total_seats: 45,
        photo_url: '/images/coastal-private-bus.jpg',
        departure_time: '09:55 AM',
        frequency: 'Daily',
        journey_duration: '3 hours 05 minutes',
        conductor: { name: 'Manjunath Shetty', phone: '98451 12345' },
        stops: [
          { stop_name: 'Mangaluru', planned_arrival: '09:55 AM' },
          { stop_name: 'Kuntikana', planned_arrival: '10:05 AM' },
          { stop_name: 'Kulur', planned_arrival: '10:15 AM' },
          { stop_name: 'Surathkal', planned_arrival: '10:40 AM' },
          { stop_name: 'Mulki', planned_arrival: '11:05 AM' },
          { stop_name: 'Padubidri', planned_arrival: '11:20 AM' },
          { stop_name: 'Kaup', planned_arrival: '11:35 AM' },
          { stop_name: 'Udupi', planned_arrival: '12:15 PM' },
          { stop_name: 'Kundapura', planned_arrival: '01:00 PM' },
        ],
      },
      {
        bus_name: 'Sri Lakshmi Travels',
        vehicle_number: 'KA 20 CD 5678',
        route_number: '002',
        service_type: 'AC',
        origin: 'Mangaluru',
        destination: 'Kundapura',
        total_seats: 40,
        photo_url: '/images/coastal-private-bus.jpg',
        departure_time: '10:30 AM',
        frequency: 'Daily',
        journey_duration: '3 hours 05 minutes',
        conductor: { name: 'Santhosh Poojary', phone: '98452 23456' },
        stops: [
          { stop_name: 'Mangaluru', planned_arrival: '10:30 AM' },
          { stop_name: 'Kuntikana', planned_arrival: '10:40 AM' },
          { stop_name: 'Kulur', planned_arrival: '10:50 AM' },
          { stop_name: 'Surathkal', planned_arrival: '11:15 AM' },
          { stop_name: 'Mulki', planned_arrival: '11:40 AM' },
          { stop_name: 'Padubidri', planned_arrival: '11:55 AM' },
          { stop_name: 'Kaup', planned_arrival: '12:10 PM' },
          { stop_name: 'Udupi', planned_arrival: '12:50 PM' },
          { stop_name: 'Kundapura', planned_arrival: '01:35 PM' },
        ],
      },
      {
        bus_name: 'Udupi Express',
        vehicle_number: 'KA 21 GH 3456',
        route_number: '004',
        service_type: 'Non AC',
        origin: 'Mangaluru',
        destination: 'Kundapura',
        total_seats: 45,
        photo_url: '/images/coastal-private-bus.jpg',
        departure_time: '11:45 AM',
        frequency: 'Daily',
        journey_duration: '3 hours 05 minutes',
        conductor: { name: 'Pradeep Kumar', phone: '98453 34567' },
        stops: [
          { stop_name: 'Mangaluru', planned_arrival: '11:45 AM' },
          { stop_name: 'Kuntikana', planned_arrival: '11:55 AM' },
          { stop_name: 'Kulur', planned_arrival: '12:05 PM' },
          { stop_name: 'Surathkal', planned_arrival: '12:30 PM' },
          { stop_name: 'Mulki', planned_arrival: '12:55 PM' },
          { stop_name: 'Padubidri', planned_arrival: '01:10 PM' },
          { stop_name: 'Kaup', planned_arrival: '01:25 PM' },
          { stop_name: 'Udupi', planned_arrival: '02:05 PM' },
          { stop_name: 'Kundapura', planned_arrival: '02:50 PM' },
        ],
      },
    ]

    for (const b of rakeshBuses) {
      const cleanVeh = b.vehicle_number.toUpperCase().replace(/\s+/g, '-')
      const exist = await pgPool.query(
        "SELECT bus_id FROM buses WHERE UPPER(REPLACE(vehicle_number, ' ', '-')) = $1",
        [cleanVeh]
      )
      let busId
      if (exist.rows.length === 0) {
        const ins = await pgPool.query(
          'INSERT INTO buses (bus_name, vehicle_number, route_number, service_type, origin, destination, is_last_bus, conductor_pin, owner_email, total_seats, photo_url, departure_time, frequency, journey_duration) VALUES ($1, $2, $3, $4, $5, $6, 0, \'4509\', \'rakesh@gmail.com\', $7, $8, $9, $10, $11) RETURNING bus_id',
          [
            b.bus_name,
            cleanVeh,
            b.route_number,
            b.service_type,
            b.origin,
            b.destination,
            b.total_seats,
            b.photo_url,
            b.departure_time,
            b.frequency,
            b.journey_duration,
          ]
        )
        busId = ins.rows[0].bus_id
      } else {
        busId = exist.rows[0].bus_id
        await pgPool.query(
          "UPDATE buses SET bus_name = $1, service_type = $2, departure_time = $3, origin = $4, destination = $5, owner_email = 'rakesh@gmail.com' WHERE bus_id = $6",
          [b.bus_name, b.service_type, b.departure_time, b.origin, b.destination, busId]
        )
      }

      await pgPool.query('DELETE FROM bus_route_stops WHERE bus_id = $1', [busId])
      for (let i = 0; i < b.stops.length; i++) {
        await pgPool.query(
          'INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES ($1, $2, $3, $4)',
          [busId, i + 1, b.stops[i].stop_name, b.stops[i].planned_arrival]
        )
      }

      // Detach any other conductor from this bus
      await pgPool.query(
        "UPDATE conductors SET assigned_bus_id = NULL WHERE assigned_bus_id = $1 AND name != $2",
        [busId, b.conductor.name]
      )

      const cCheck = await pgPool.query(
        "SELECT conductor_id FROM conductors WHERE owner_email = 'rakesh@gmail.com' AND name = $1",
        [b.conductor.name]
      )
      if (cCheck.rows.length === 0) {
        await pgPool.query(
          "INSERT INTO conductors (owner_email, name, phone, assigned_bus_id, status) VALUES ('rakesh@gmail.com', $1, $2, $3, 'Active')",
          [b.conductor.name, b.conductor.phone, busId]
        )
      } else {
        await pgPool.query(
          "UPDATE conductors SET assigned_bus_id = $1, phone = $2, status = 'Active' WHERE conductor_id = $3",
          [busId, b.conductor.phone, cCheck.rows[0].conductor_id]
        )
      }
    }

    await pgPool.query("DELETE FROM buses WHERE owner_email = 'rakesh@gmail.com' AND UPPER(REPLACE(vehicle_number, ' ', '-')) NOT IN ('KA-19-AB-1234', 'KA-20-CD-5678', 'KA-21-GH-3456')")
  } catch (err) {
    console.warn('Could not seed Rakesh fleet:', err.message)
  }
}
// ============================================================================
// SQLITE SCHEMA INITIALIZATION
// ============================================================================
function initSqliteSchema() {
  return new Promise((resolve, reject) => {
    sqliteDb.serialize(() => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS buses (
          bus_id INTEGER PRIMARY KEY AUTOINCREMENT,
          bus_name TEXT NOT NULL,
          vehicle_number TEXT NOT NULL UNIQUE,
          route_number TEXT NOT NULL,
          service_type TEXT NOT NULL DEFAULT 'Express',
          origin TEXT NOT NULL,
          destination TEXT NOT NULL,
          is_last_bus INTEGER DEFAULT 0,
          conductor_pin TEXT,
          owner_email TEXT DEFAULT 'vishal@gmail.com',
          total_seats INTEGER DEFAULT 45,
          photo_url TEXT,
          departure_time TEXT,
          frequency TEXT DEFAULT 'Daily',
          journey_duration TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      sqliteDb.run('ALTER TABLE buses ADD COLUMN conductor_pin TEXT', () => {})
      sqliteDb.run("ALTER TABLE buses ADD COLUMN owner_email TEXT DEFAULT 'vishal@gmail.com'", () => {})
      sqliteDb.run('ALTER TABLE buses ADD COLUMN total_seats INTEGER DEFAULT 45', () => {})
      sqliteDb.run('ALTER TABLE buses ADD COLUMN photo_url TEXT', () => {})
      sqliteDb.run('ALTER TABLE buses ADD COLUMN departure_time TEXT', () => {})
      sqliteDb.run("ALTER TABLE buses ADD COLUMN frequency TEXT DEFAULT 'Daily'", () => {})
      sqliteDb.run('ALTER TABLE buses ADD COLUMN journey_duration TEXT', () => {})

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS driver_shifts (
          shift_id INTEGER PRIMARY KEY AUTOINCREMENT,
          driver_phone TEXT NOT NULL,
          vehicle_number TEXT NOT NULL,
          bus_name TEXT NOT NULL,
          route_name TEXT NOT NULL,
          start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          end_time DATETIME,
          status TEXT DEFAULT 'ACTIVE'
        )
      `)

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS gps_telemetry (
          log_id INTEGER PRIMARY KEY AUTOINCREMENT,
          bus_id INTEGER,
          bus_name TEXT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          speed INTEGER DEFAULT 0,
          delay_minutes INTEGER DEFAULT 0,
          recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS owners (
          owner_id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          agency_name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS email_otps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          otp_code TEXT,
          otp_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER DEFAULT 0,
          used INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `)

      sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(email, used)`)

      // Migrate existing email_otps table if columns or constraints need updating
      sqliteDb.all('PRAGMA table_info(email_otps)', [], (_err, cols) => {
        if (cols && Array.isArray(cols)) {
          const colMap = new Map(cols.map((c) => [c.name, c]))
          const otpCodeCol = colMap.get('otp_code')
          const needsRecreation = !colMap.has('otp_hash') || (otpCodeCol && otpCodeCol.notnull === 1)

          if (needsRecreation) {
            sqliteDb.serialize(() => {
              sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS email_otps_v2 (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT NOT NULL,
                  otp_code TEXT,
                  otp_hash TEXT NOT NULL,
                  expires_at INTEGER NOT NULL,
                  attempts INTEGER DEFAULT 0,
                  used INTEGER DEFAULT 0,
                  created_at INTEGER NOT NULL
                )
              `)
              sqliteDb.run(`
                INSERT INTO email_otps_v2 (id, email, otp_code, otp_hash, expires_at, used, created_at)
                SELECT id, email, otp_code, COALESCE(otp_hash, 'LEGACY'), expires_at, used, COALESCE(expires_at - 300000, 0)
                FROM email_otps
              `, () => {
                sqliteDb.run('DROP TABLE IF EXISTS email_otps', () => {
                  sqliteDb.run('ALTER TABLE email_otps_v2 RENAME TO email_otps', () => {
                    sqliteDb.run('CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(email, used)')
                  })
                })
              })
            })
          }
        }
      })

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS bus_route_stops (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bus_id INTEGER NOT NULL,
          stop_order INTEGER NOT NULL,
          stop_name TEXT NOT NULL,
          planned_arrival TEXT NOT NULL,
          FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE
        )
      `)

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS conductors (
          conductor_id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_email TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          assigned_bus_id INTEGER,
          status TEXT DEFAULT 'Active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (assigned_bus_id) REFERENCES buses(bus_id) ON DELETE SET NULL
        )
      `)

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS owner_activities (
          activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_email TEXT NOT NULL,
          action_type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS bus_stops (
          stop_id INTEGER PRIMARY KEY AUTOINCREMENT,
          stop_name TEXT NOT NULL UNIQUE,
          stop_name_kn TEXT NOT NULL,
          alternative_names TEXT NOT NULL,
          nearby_landmarks TEXT NOT NULL,
          locality TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS passenger_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT,
          email TEXT,
          category TEXT DEFAULT 'General',
          rating INTEGER DEFAULT 5,
          message TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      sqliteDb.get('SELECT COUNT(*) AS count FROM buses', (err, row) => {
        if (err) {
          console.error('Error checking buses table:', err.message)
          reject(err)
          return
        }

        if (row && row.count === 0) {
          const stmt = sqliteDb.prepare(`
            INSERT INTO buses (bus_name, vehicle_number, route_number, service_type, origin, destination, is_last_bus, conductor_pin, owner_email, total_seats, departure_time, frequency, journey_duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)

          stmt.run('Vishal Express', 'KA-19-AB-4509', '15', 'Express', 'Mangaluru', 'Surathkal', 0, '4509', 'vishal@gmail.com', 45, '06:30 AM', 'Daily', '35 minutes')
          stmt.run('Canara Pinto Deluxe', 'KA-20-C-8812', 'NH-66', 'Express', 'Mangaluru', 'Udupi', 0, '8812', 'vishal@gmail.com', 50, '07:15 AM', 'Daily', '1 hour 45 minutes')
          stmt.run('Padmambika Local', 'KA-19-F-3304', '21', 'City / Ordinary', 'Mangaluru', 'Kuloor', 1, '3304', 'vishal@gmail.com', 40, '08:00 AM', 'Daily', '30 minutes')
          stmt.finalize(() => {
            seedDefaultStopsSqlite()
          })
        } else {
          sqliteDb.run("UPDATE buses SET conductor_pin = '4509' WHERE vehicle_number = 'KA-19-AB-4509' AND (conductor_pin IS NULL OR conductor_pin = '')")
          sqliteDb.run("UPDATE buses SET conductor_pin = '8812' WHERE vehicle_number = 'KA-20-C-8812' AND (conductor_pin IS NULL OR conductor_pin = '')")
          sqliteDb.run("UPDATE buses SET conductor_pin = '3304' WHERE vehicle_number = 'KA-19-F-3304' AND (conductor_pin IS NULL OR conductor_pin = '')")
          sqliteDb.run("UPDATE buses SET owner_email = 'vishal@gmail.com' WHERE owner_email IS NULL OR owner_email = ''")
          seedDefaultStopsSqlite()
        }

        sqliteDb.run("INSERT OR IGNORE INTO owners (email, agency_name) VALUES ('vishal@gmail.com', 'Vishal Coastal Travels')")
        sqliteDb.run("INSERT OR IGNORE INTO owners (email, agency_name) VALUES ('rakesh@gmail.com', 'Rakesh Shetty Travels')")

        seedRakeshFleetSqlite(() => {
          seedVerifiedBusStopsSqlite(() => {
            isConnected = true
            console.log(`✅ SQL Database connected: ${getDatabaseType()}`)
            resolve(true)
          })
        })
      })
    })
  })
}

function seedRakeshFleetSqlite(cb) {
  const rakeshBuses = [
    {
      bus_name: 'Shri Durga Travels',
      vehicle_number: 'KA-19-AB-1234',
      route_number: '001',
      service_type: 'Non AC',
      origin: 'Mangaluru',
      destination: 'Kundapura',
      total_seats: 45,
      departure_time: '09:55 AM',
      frequency: 'Daily',
      journey_duration: '3 hours 05 minutes',
      conductor: { name: 'Manjunath Shetty', phone: '98451 12345' },
      stops: [
        { stop_name: 'Mangaluru', planned_arrival: '09:55 AM' },
        { stop_name: 'Kuntikana', planned_arrival: '10:05 AM' },
        { stop_name: 'Kulur', planned_arrival: '10:15 AM' },
        { stop_name: 'Surathkal', planned_arrival: '10:40 AM' },
        { stop_name: 'Mulki', planned_arrival: '11:05 AM' },
        { stop_name: 'Padubidri', planned_arrival: '11:20 AM' },
        { stop_name: 'Kaup', planned_arrival: '11:35 AM' },
        { stop_name: 'Udupi', planned_arrival: '12:15 PM' },
        { stop_name: 'Kundapura', planned_arrival: '01:00 PM' },
      ],
    },
    {
      bus_name: 'Sri Lakshmi Travels',
      vehicle_number: 'KA-20-CD-5678',
      route_number: '002',
      service_type: 'AC',
      origin: 'Mangaluru',
      destination: 'Kundapura',
      total_seats: 40,
      departure_time: '10:30 AM',
      frequency: 'Daily',
      journey_duration: '3 hours 05 minutes',
      conductor: { name: 'Santhosh Poojary', phone: '98452 23456' },
      stops: [
        { stop_name: 'Mangaluru', planned_arrival: '10:30 AM' },
        { stop_name: 'Kuntikana', planned_arrival: '10:40 AM' },
        { stop_name: 'Kulur', planned_arrival: '10:50 AM' },
        { stop_name: 'Surathkal', planned_arrival: '11:15 AM' },
        { stop_name: 'Mulki', planned_arrival: '11:40 AM' },
        { stop_name: 'Padubidri', planned_arrival: '11:55 AM' },
        { stop_name: 'Kaup', planned_arrival: '12:10 PM' },
        { stop_name: 'Udupi', planned_arrival: '12:50 PM' },
        { stop_name: 'Kundapura', planned_arrival: '01:35 PM' },
      ],
    },
    {
      bus_name: 'Udupi Express',
      vehicle_number: 'KA-21-GH-3456',
      route_number: '004',
      service_type: 'Non AC',
      origin: 'Mangaluru',
      destination: 'Kundapura',
      total_seats: 45,
      departure_time: '11:45 AM',
      frequency: 'Daily',
      journey_duration: '3 hours 05 minutes',
      conductor: { name: 'Pradeep Kumar', phone: '98453 34567' },
      stops: [
        { stop_name: 'Mangaluru', planned_arrival: '11:45 AM' },
        { stop_name: 'Kuntikana', planned_arrival: '11:55 AM' },
        { stop_name: 'Kulur', planned_arrival: '12:05 PM' },
        { stop_name: 'Surathkal', planned_arrival: '12:30 PM' },
        { stop_name: 'Mulki', planned_arrival: '12:55 PM' },
        { stop_name: 'Padubidri', planned_arrival: '01:10 PM' },
        { stop_name: 'Kaup', planned_arrival: '01:25 PM' },
        { stop_name: 'Udupi', planned_arrival: '02:05 PM' },
        { stop_name: 'Kundapura', planned_arrival: '02:50 PM' },
      ],
    },
  ]

  let remaining = rakeshBuses.length
  rakeshBuses.forEach((b) => {
    sqliteDb.get(
      'SELECT bus_id FROM buses WHERE UPPER(REPLACE(vehicle_number, " ", "-")) = ?',
      [b.vehicle_number],
      (err, row) => {
        if (!row) {
          sqliteDb.run(
            'INSERT INTO buses (bus_name, vehicle_number, route_number, service_type, origin, destination, is_last_bus, conductor_pin, owner_email, total_seats, photo_url, departure_time, frequency, journey_duration) VALUES (?, ?, ?, ?, ?, ?, 0, \'4509\', \'rakesh@gmail.com\', ?, \'/images/coastal-private-bus.jpg\', ?, ?, ?)',
            [
              b.bus_name,
              b.vehicle_number,
              b.route_number,
              b.service_type,
              b.origin,
              b.destination,
              b.total_seats,
              b.departure_time,
              b.frequency,
              b.journey_duration,
            ],
            function (insErr) {
              if (!insErr) {
                const busId = this.lastID
                const stopStmt = sqliteDb.prepare(
                  'INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES (?, ?, ?, ?)'
                )
                b.stops.forEach((s, idx) => {
                  stopStmt.run(busId, idx + 1, s.stop_name, s.planned_arrival)
                })
                stopStmt.finalize()

                sqliteDb.run(
                  "INSERT OR REPLACE INTO conductors (owner_email, name, phone, assigned_bus_id, status) VALUES ('rakesh@gmail.com', ?, ?, ?, 'Active')",
                  [b.conductor.name, b.conductor.phone, busId]
                )
              }
              remaining--
              if (remaining <= 0 && cb) cb()
            }
          )
        } else {
          const busId = row.bus_id
          sqliteDb.run(
            'UPDATE buses SET bus_name = ?, service_type = ?, departure_time = ?, origin = ?, destination = ?, owner_email = "rakesh@gmail.com" WHERE bus_id = ?',
            [b.bus_name, b.service_type, b.departure_time, b.origin, b.destination, busId],
            () => {
              sqliteDb.run('DELETE FROM bus_route_stops WHERE bus_id = ?', [busId], () => {
                const stopStmt = sqliteDb.prepare(
                  'INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES (?, ?, ?, ?)'
                )
                b.stops.forEach((s, idx) => {
                  stopStmt.run(busId, idx + 1, s.stop_name, s.planned_arrival)
                })
                stopStmt.finalize(() => {
                  sqliteDb.run(
                    "UPDATE conductors SET assigned_bus_id = ?, phone = ?, status = 'Active' WHERE owner_email = 'rakesh@gmail.com' AND name = ?",
                    [busId, b.conductor.phone, b.conductor.name],
                    () => {
                      remaining--
                      if (remaining <= 0 && cb) cb()
                    }
                  )
                })
              })
            }
          )
        }
      }
    )
  })
}
function seedDefaultStopsSqlite() {
  sqliteDb.get('SELECT COUNT(*) AS count FROM bus_route_stops', (_, row) => {
    if (row && row.count === 0) {
      const stopStmt = sqliteDb.prepare('INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES (?, ?, ?, ?)')
      stopStmt.run(1, 1, 'Mangaluru', '06:30 AM')
      stopStmt.run(1, 2, 'Surathkal', '07:05 AM')
      stopStmt.run(1, 3, 'Kundapura', '09:00 AM')
      stopStmt.run(1, 4, 'Udupi', '10:00 AM')

      stopStmt.run(2, 1, 'Mangaluru', '07:15 AM')
      stopStmt.run(2, 2, 'Kuloor', '07:35 AM')
      stopStmt.run(2, 3, 'Surathkal', '08:00 AM')
      stopStmt.run(2, 4, 'Udupi', '09:15 AM')

      stopStmt.run(3, 1, 'Mangaluru', '08:00 AM')
      stopStmt.run(3, 2, 'Urwa Market', '08:15 AM')
      stopStmt.run(3, 3, 'Kuloor', '08:35 AM')
      stopStmt.finalize()
    }
  })
}

// ============================================================================
// DATA ACCESS FUNCTIONS (DUAL ENGINE)
// ============================================================================

// 1. Shift Recording
export async function recordShift(data) {
  if (isPostgres()) {
    const res = await pgPool.query(
      `INSERT INTO driver_shifts (driver_phone, vehicle_number, bus_name, route_name)
       VALUES ($1, $2, $3, $4) RETURNING shift_id`,
      [data.driver_phone, data.vehicle_number, data.bus_name, data.route_name]
    )
    return { shift_id: res.rows[0].shift_id, ...data }
  }

  return new Promise((resolve) => {
    sqliteDb.run(
      'INSERT INTO driver_shifts (driver_phone, vehicle_number, bus_name, route_name) VALUES (?, ?, ?, ?)',
      [data.driver_phone, data.vehicle_number, data.bus_name, data.route_name],
      function (err) {
        if (err) resolve(null)
        else resolve({ shift_id: this.lastID, ...data })
      }
    )
  })
}

// 2. GPS Telemetry Recording
export async function recordTelemetry(data) {
  const recordedAt = data.recorded_at || (data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString())
  if (isPostgres()) {
    const res = await pgPool.query(
      `INSERT INTO gps_telemetry (bus_id, bus_name, latitude, longitude, speed, delay_minutes, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING log_id`,
      [data.bus_id || 1, data.bus_name || 'Vishal Express', data.latitude, data.longitude, data.speed || 0, data.delay_minutes || 0, recordedAt]
    )
    return res.rows[0].log_id
  }

  return new Promise((resolve) => {
    sqliteDb.run(
      'INSERT INTO gps_telemetry (bus_id, bus_name, latitude, longitude, speed, delay_minutes, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [data.bus_id || 1, data.bus_name || 'Vishal Express', data.latitude, data.longitude, data.speed || 0, data.delay_minutes || 0, recordedAt],
      function (err) {
        if (err) resolve(null)
        else resolve(this.lastID)
      }
    )
  })
}

// 3. Fetch Route Stops for a Bus
export async function getBusRouteStops(busId) {
  if (isPostgres()) {
    const res = await pgPool.query(
      'SELECT stop_order, stop_name, planned_arrival FROM bus_route_stops WHERE bus_id = $1 ORDER BY stop_order ASC',
      [busId]
    )
    return res.rows || []
  }

  return new Promise((resolve) => {
    sqliteDb.all(
      'SELECT stop_order, stop_name, planned_arrival FROM bus_route_stops WHERE bus_id = ? ORDER BY stop_order ASC',
      [busId],
      (err, rows) => {
        resolve(err ? [] : rows || [])
      }
    )
  })
}

// 4. Fetch All Registered Buses
export async function getBuses() {
  if (isPostgres()) {
    const res = await pgPool.query('SELECT * FROM buses ORDER BY bus_id ASC')
    const buses = res.rows || []
    return Promise.all(
      buses.map(async (bus) => {
        const stops = await getBusRouteStops(bus.bus_id)
        return {
          ...bus,
          stops: stops.length > 0 ? stops : [
            { stop_order: 1, stop_name: bus.origin || 'Mangaluru', planned_arrival: bus.departure_time || '06:30 AM' },
            { stop_order: 2, stop_name: bus.destination || 'Udupi', planned_arrival: '10:00 AM' },
          ],
        }
      })
    )
  }

  return new Promise((resolve) => {
    sqliteDb.all('SELECT * FROM buses ORDER BY bus_id ASC', async (err, rows) => {
      if (err || !rows) return resolve([])
      const busesWithStops = await Promise.all(
        rows.map(async (bus) => {
          const stops = await getBusRouteStops(bus.bus_id)
          return {
            ...bus,
            stops: stops.length > 0 ? stops : [
              { stop_order: 1, stop_name: bus.origin || 'Mangaluru', planned_arrival: bus.departure_time || '06:30 AM' },
              { stop_order: 2, stop_name: bus.destination || 'Udupi', planned_arrival: '10:00 AM' },
            ],
          }
        })
      )
      resolve(busesWithStops)
    })
  })
}

// 5. Fetch Single Bus by Vehicle Number
export async function getBusByVehicleNumber(vehicleNumber) {
  const normalized = vehicleNumber.replace(/\s+/g, '-').toUpperCase()

  if (isPostgres()) {
    const res = await pgPool.query(
      `SELECT * FROM buses WHERE UPPER(REPLACE(vehicle_number, ' ', '-')) = $1 LIMIT 1`,
      [normalized]
    )
    if (!res.rows || res.rows.length === 0) return null
    const bus = res.rows[0]
    const stops = await getBusRouteStops(bus.bus_id)
    return { ...bus, stops }
  }

  return new Promise((resolve) => {
    sqliteDb.get(
      'SELECT * FROM buses WHERE UPPER(REPLACE(vehicle_number, " ", "-")) = ? LIMIT 1',
      [normalized],
      async (err, row) => {
        if (err || !row) resolve(null)
        else {
          const stops = await getBusRouteStops(row.bus_id)
          resolve({ ...row, stops })
        }
      }
    )
  })
}

// 6. Fetch Single Bus by ID
export async function getBusById(busId, ownerEmail = null) {
  if (isPostgres()) {
    const query = ownerEmail
      ? 'SELECT * FROM buses WHERE bus_id = $1 AND LOWER(owner_email) = LOWER($2) LIMIT 1'
      : 'SELECT * FROM buses WHERE bus_id = $1 LIMIT 1'
    const params = ownerEmail ? [busId, ownerEmail] : [busId]
    const res = await pgPool.query(query, params)
    if (!res.rows || res.rows.length === 0) return null
    const bus = res.rows[0]
    const stops = await getBusRouteStops(busId)
    return { ...bus, stops }
  }

  return new Promise((resolve) => {
    const query = ownerEmail
      ? 'SELECT * FROM buses WHERE bus_id = ? AND LOWER(owner_email) = LOWER(?) LIMIT 1'
      : 'SELECT * FROM buses WHERE bus_id = ? LIMIT 1'
    const params = ownerEmail ? [busId, ownerEmail] : [busId]
    sqliteDb.get(query, params, async (err, row) => {
      if (err || !row) resolve(null)
      else {
        const stops = await getBusRouteStops(busId)
        resolve({ ...row, stops })
      }
    })
  })
}

// 7. Fetch Buses by Owner
export async function getBusesByOwner(ownerEmail) {
  const cleanEmail = (ownerEmail || '').toLowerCase().trim()
  const isRakesh = cleanEmail === 'rakeshtravels018@gmail.com' || cleanEmail === 'rakesh@gmail.com'

  if (isPostgres()) {
    const query = isRakesh
      ? "SELECT * FROM buses WHERE LOWER(owner_email) IN ('rakeshtravels018@gmail.com', 'rakesh@gmail.com') ORDER BY bus_id ASC"
      : 'SELECT * FROM buses WHERE LOWER(owner_email) = LOWER($1) ORDER BY bus_id ASC'
    const res = await pgPool.query(query, isRakesh ? [] : [ownerEmail])
    const buses = res.rows || []
    return Promise.all(
      buses.map(async (bus) => {
        const stops = await getBusRouteStops(bus.bus_id)
        return {
          ...bus,
          stops: stops.length > 0 ? stops : [
            { stop_order: 1, stop_name: bus.origin || 'Mangaluru', planned_arrival: bus.departure_time || '06:30 AM' },
            { stop_order: 2, stop_name: bus.destination || 'Udupi', planned_arrival: '10:00 AM' },
          ],
        }
      })
    )
  }

  return new Promise((resolve) => {
    const sql = isRakesh
      ? "SELECT * FROM buses WHERE LOWER(owner_email) IN ('rakeshtravels018@gmail.com', 'rakesh@gmail.com') ORDER BY bus_id ASC"
      : 'SELECT * FROM buses WHERE LOWER(owner_email) = LOWER(?) ORDER BY bus_id ASC'
    sqliteDb.all(sql, isRakesh ? [] : [ownerEmail], async (err, rows) => {
      if (err || !rows) return resolve([])
      const busesWithStops = await Promise.all(
        rows.map(async (bus) => {
          const stops = await getBusRouteStops(bus.bus_id)
          return {
            ...bus,
            stops: stops.length > 0 ? stops : [
              { stop_order: 1, stop_name: bus.origin || 'Mangaluru', planned_arrival: bus.departure_time || '06:30 AM' },
              { stop_order: 2, stop_name: bus.destination || 'Udupi', planned_arrival: '10:00 AM' },
            ],
          }
        })
      )
      resolve(busesWithStops)
    })
  })
}

// 8. Owner Authentication Helpers
export async function getOwnerByEmail(email) {
  const cleanEmail = (email || '').toLowerCase().trim()
  if (isPostgres()) {
    const res = await pgPool.query('SELECT email, agency_name FROM owners WHERE LOWER(email) = LOWER($1) LIMIT 1', [cleanEmail])
    if (res.rows?.[0]) return res.rows[0]
    if (cleanEmail === 'rakeshtravels018@gmail.com') {
      return { email: cleanEmail, agency_name: 'Rakesh Shetty Travels' }
    }
    return null
  }

  return new Promise((resolve, reject) => {
    sqliteDb.get(
      'SELECT email, agency_name FROM owners WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [cleanEmail],
      (err, row) => {
        if (err) reject(err)
        else if (row) resolve(row)
        else if (cleanEmail === 'rakeshtravels018@gmail.com') {
          resolve({ email: cleanEmail, agency_name: 'Rakesh Shetty Travels' })
        } else resolve(null)
      }
    )
  })
}

export async function createOwner(emailOrObj, agencyName) {
  const email =
    typeof emailOrObj === 'object' && emailOrObj !== null
      ? emailOrObj.email
      : emailOrObj
  const agency =
    typeof emailOrObj === 'object' && emailOrObj !== null
      ? emailOrObj.agency_name || agencyName
      : agencyName

  if (!email) return false
  const cleanEmail = String(email).trim().toLowerCase()

  if (isPostgres()) {
    try {
      await pgPool.query(
        'INSERT INTO owners (email, agency_name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
        [cleanEmail, agency]
      )
      return true
    } catch {
      return false
    }
  }

  return new Promise((resolve) => {
    sqliteDb.run(
      'INSERT OR IGNORE INTO owners (email, agency_name) VALUES (?, ?)',
      [cleanEmail, agency],
      function (err) {
        resolve(!err)
      }
    )
  })
}

// 9. Conductor PIN Verification
export async function verifyConductorPin(vehicleNumber, pin, driverPhone = null) {
  const normalized = vehicleNumber.replace(/\s+/g, '-').toUpperCase()

  let bus = null
  if (isPostgres()) {
    const res = await pgPool.query(
      `SELECT * FROM buses WHERE UPPER(REPLACE(vehicle_number, ' ', '-')) = $1 LIMIT 1`,
      [normalized]
    )
    bus = res.rows?.[0] || null
  } else {
    bus = await new Promise((resolve) => {
      sqliteDb.get(
        'SELECT * FROM buses WHERE UPPER(REPLACE(vehicle_number, " ", "-")) = ? LIMIT 1',
        [normalized],
        (err, row) => resolve(row || null)
      )
    })
  }

  if (!bus) return { success: false, error: 'Vehicle number not found in registered fleet.' }
  if (!matchesConductorPin(bus.conductor_pin, pin)) {
    return { success: false, error: 'Incorrect Secret PIN for ' + bus.vehicle_number }
  }

  if (driverPhone) {
    const cleanPhone = String(driverPhone).replace(/\D/g, '')
    let conductors = []
    if (isPostgres()) {
      const cRes = await pgPool.query(
        'SELECT * FROM conductors WHERE (assigned_bus_id = $1 OR assigned_bus_id IS NULL) AND LOWER(owner_email) = LOWER($2)',
        [bus.bus_id, bus.owner_email]
      )
      conductors = cRes.rows || []
    } else {
      conductors = await new Promise((resolve) => {
        sqliteDb.all(
          'SELECT * FROM conductors WHERE (assigned_bus_id = ? OR assigned_bus_id IS NULL) AND LOWER(owner_email) = LOWER(?)',
          [bus.bus_id, bus.owner_email],
          (err, rows) => resolve(rows || [])
        )
      })
    }

    const matching = conductors.find((c) => c.phone.replace(/\D/g, '').includes(cleanPhone))
    if (matching && matching.status !== 'Active') {
      return { success: false, error: 'Conductor duty authorization has been revoked.' }
    }
  }

  return { success: true, bus }
}

// 10. Save Bus (with multi-stop route using transactional persistence)
export async function saveBus(bus) {
  const cleanVeh = bus.vehicle_number.toUpperCase()
  const stops = Array.isArray(bus.stops) ? bus.stops : []

  if (isPostgres()) {
    const client = await pgPool.connect()
    try {
      await client.query('BEGIN')
      const ins = await client.query(
        `INSERT INTO buses (
          bus_name, vehicle_number, route_number, service_type,
          origin, destination, is_last_bus, conductor_pin,
          owner_email, total_seats, photo_url, departure_time,
          frequency, journey_duration
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING bus_id`,
        [
          bus.bus_name,
          cleanVeh,
          bus.route_number || '001',
          bus.service_type || 'Express',
          bus.origin || 'Mangaluru',
          bus.destination || 'Udupi',
          bus.is_last_bus ? 1 : 0,
          bus.conductor_pin || null,
          bus.owner_email || 'vishal@gmail.com',
          bus.total_seats || 45,
          bus.photo_url || '/images/coastal-private-bus.jpg',
          bus.departure_time || '06:30 AM',
          bus.frequency || 'Daily',
          bus.journey_duration || '3 hours 30 minutes',
        ]
      )

      const newBusId = ins.rows[0].bus_id
      for (let idx = 0; idx < stops.length; idx++) {
        await client.query(
          'INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES ($1, $2, $3, $4)',
          [newBusId, idx + 1, stops[idx].stop_name || '', stops[idx].planned_arrival || '']
        )
      }

      await client.query('COMMIT')
      return { bus_id: newBusId, ...bus, stops }
    } catch (err) {
      await client.query('ROLLBACK')
      console.error('Error inserting bus to PostgreSQL:', err.message)
      return null
    } finally {
      client.release()
    }
  }

  // SQLite Save Bus with transaction
  return new Promise((resolve) => {
    sqliteDb.serialize(() => {
      sqliteDb.run('BEGIN TRANSACTION')
      sqliteDb.run(
        `INSERT INTO buses (
          bus_name, vehicle_number, route_number, service_type,
          origin, destination, is_last_bus, conductor_pin,
          owner_email, total_seats, photo_url, departure_time,
          frequency, journey_duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bus.bus_name,
          cleanVeh,
          bus.route_number || '001',
          bus.service_type || 'Express',
          bus.origin || 'Mangaluru',
          bus.destination || 'Udupi',
          bus.is_last_bus ? 1 : 0,
          bus.conductor_pin || null,
          bus.owner_email || 'vishal@gmail.com',
          bus.total_seats || 45,
          bus.photo_url || '/images/coastal-private-bus.jpg',
          bus.departure_time || '06:30 AM',
          bus.frequency || 'Daily',
          bus.journey_duration || '3 hours 30 minutes',
        ],
        function (err) {
          if (err) {
            console.error('Error inserting bus to SQLite:', err.message)
            sqliteDb.run('ROLLBACK')
            resolve(null)
            return
          }

          const newBusId = this.lastID
          if (stops.length === 0) {
            sqliteDb.run('COMMIT')
            resolve({ bus_id: newBusId, ...bus, stops: [] })
            return
          }

          const stmt = sqliteDb.prepare(
            'INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES (?, ?, ?, ?)'
          )
          stops.forEach((stop, idx) => {
            stmt.run(newBusId, idx + 1, stop.stop_name || '', stop.planned_arrival || '')
          })
          stmt.finalize((stmtErr) => {
            if (stmtErr) {
              sqliteDb.run('ROLLBACK')
              resolve(null)
            } else {
              sqliteDb.run('COMMIT')
              resolve({ bus_id: newBusId, ...bus, stops })
            }
          })
        }
      )
    })
  })
}

// 11. Update Bus (with multi-stop route using transactional persistence)
export async function updateBus(busId, bus) {
  const cleanVeh = bus.vehicle_number.toUpperCase()
  const stops = Array.isArray(bus.stops) ? bus.stops : []

  if (isPostgres()) {
    const client = await pgPool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE buses SET
          bus_name = $1,
          vehicle_number = $2,
          route_number = $3,
          service_type = $4,
          origin = $5,
          destination = $6,
          total_seats = $7,
          photo_url = $8,
          departure_time = $9,
          frequency = $10,
          journey_duration = $11
        WHERE bus_id = $12 AND LOWER(owner_email) = LOWER($13)`,
        [
          bus.bus_name,
          cleanVeh,
          bus.route_number || '001',
          bus.service_type || 'Express',
          bus.origin || 'Mangaluru',
          bus.destination || 'Udupi',
          bus.total_seats || 45,
          bus.photo_url || '/images/coastal-private-bus.jpg',
          bus.departure_time || '06:30 AM',
          bus.frequency || 'Daily',
          bus.journey_duration || '3 hours 30 minutes',
          busId,
          bus.owner_email,
        ]
      )

      await client.query('DELETE FROM bus_route_stops WHERE bus_id = $1', [busId])
      for (let idx = 0; idx < stops.length; idx++) {
        await client.query(
          'INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES ($1, $2, $3, $4)',
          [busId, idx + 1, stops[idx].stop_name || '', stops[idx].planned_arrival || '']
        )
      }

      await client.query('COMMIT')
      return { bus_id: busId, ...bus, stops }
    } catch (err) {
      await client.query('ROLLBACK')
      console.error('Error updating bus in PostgreSQL:', err.message)
      return null
    } finally {
      client.release()
    }
  }

  return new Promise((resolve) => {
    sqliteDb.serialize(() => {
      sqliteDb.run('BEGIN TRANSACTION')
      sqliteDb.run(
        `UPDATE buses SET
          bus_name = ?,
          vehicle_number = ?,
          route_number = ?,
          service_type = ?,
          origin = ?,
          destination = ?,
          total_seats = ?,
          photo_url = ?,
          departure_time = ?,
          frequency = ?,
          journey_duration = ?
        WHERE bus_id = ? AND LOWER(owner_email) = LOWER(?)`,
        [
          bus.bus_name,
          cleanVeh,
          bus.route_number || '001',
          bus.service_type || 'Express',
          bus.origin || 'Mangaluru',
          bus.destination || 'Udupi',
          bus.total_seats || 45,
          bus.photo_url || '/images/coastal-private-bus.jpg',
          bus.departure_time || '06:30 AM',
          bus.frequency || 'Daily',
          bus.journey_duration || '3 hours 30 minutes',
          busId,
          bus.owner_email,
        ],
        function (err) {
          if (err) {
            sqliteDb.run('ROLLBACK')
            return resolve(null)
          }
          sqliteDb.run('DELETE FROM bus_route_stops WHERE bus_id = ?', [busId], (delErr) => {
            if (delErr) {
              sqliteDb.run('ROLLBACK')
              return resolve(null)
            }
            if (stops.length === 0) {
              sqliteDb.run('COMMIT')
              return resolve({ bus_id: busId, ...bus, stops: [] })
            }
            const stmt = sqliteDb.prepare(
              'INSERT INTO bus_route_stops (bus_id, stop_order, stop_name, planned_arrival) VALUES (?, ?, ?, ?)'
            )
            stops.forEach((stop, idx) => {
              stmt.run(busId, idx + 1, stop.stop_name || '', stop.planned_arrival || '')
            })
            stmt.finalize((stmtErr) => {
              if (stmtErr) {
                sqliteDb.run('ROLLBACK')
                resolve(null)
              } else {
                sqliteDb.run('COMMIT')
                resolve({ bus_id: busId, ...bus, stops })
              }
            })
          })
        }
      )
    })
  })
}

// 12. Update Conductor PIN
export async function updateBusPin(busId, pin) {
  if (isPostgres()) {
    const res = await pgPool.query('UPDATE buses SET conductor_pin = $1 WHERE bus_id = $2', [pin, busId])
    return res.rowCount > 0
  }

  return new Promise((resolve) => {
    sqliteDb.run('UPDATE buses SET conductor_pin = ? WHERE bus_id = ?', [pin, busId], function (err) {
      resolve(!err && this.changes > 0)
    })
  })
}

// 13. Delete Bus (with cascade cleanup inside transaction)
export async function deleteBus(busId, ownerEmail = null) {
  if (isPostgres()) {
    const client = await pgPool.connect()
    try {
      await client.query('BEGIN')
      if (ownerEmail) {
        const check = await client.query(
          'SELECT bus_id FROM buses WHERE bus_id = $1 AND LOWER(owner_email) = LOWER($2)',
          [busId, ownerEmail]
        )
        if (check.rowCount === 0) {
          await client.query('ROLLBACK')
          return false
        }
      }
      await client.query('UPDATE conductors SET assigned_bus_id = NULL WHERE assigned_bus_id = $1', [busId])
      await client.query('DELETE FROM bus_route_stops WHERE bus_id = $1', [busId])
      await client.query('DELETE FROM gps_telemetry WHERE bus_id = $1', [busId])
      const res = await client.query('DELETE FROM buses WHERE bus_id = $1', [busId])
      await client.query('COMMIT')
      return res.rowCount > 0
    } catch (err) {
      await client.query('ROLLBACK')
      console.error('Error deleting bus in PostgreSQL:', err.message)
      return false
    } finally {
      client.release()
    }
  }

  return new Promise((resolve) => {
    sqliteDb.run('UPDATE conductors SET assigned_bus_id = NULL WHERE assigned_bus_id = ?', [busId], () => {
      sqliteDb.run('DELETE FROM bus_route_stops WHERE bus_id = ?', [busId], () => {
        const sql = ownerEmail
          ? 'DELETE FROM buses WHERE bus_id = ? AND LOWER(owner_email) = LOWER(?)'
          : 'DELETE FROM buses WHERE bus_id = ?'
        const params = ownerEmail ? [busId, ownerEmail] : [busId]
        sqliteDb.run(sql, params, function (err) {
          resolve(!err && this.changes > 0)
        })
      })
    })
  })
}

// 13. Telemetry & Shifts Querying
export async function getRecentTelemetry(limit = 20) {
  const enrich = (rows) =>
    (rows || []).map((r) => ({
      ...r,
      recorded_at_ist: formatToIST(r.recorded_at),
      recorded_at_utc: r.recorded_at ? new Date(r.recorded_at).toISOString() : null,
    }))

  if (isPostgres()) {
    const res = await pgPool.query('SELECT * FROM gps_telemetry ORDER BY log_id DESC LIMIT $1', [limit])
    return enrich(res.rows)
  }

  return new Promise((resolve) => {
    sqliteDb.all('SELECT * FROM gps_telemetry ORDER BY log_id DESC LIMIT ?', [limit], (err, rows) => {
      resolve(err ? [] : enrich(rows))
    })
  })
}

export async function getActiveShifts() {
  if (isPostgres()) {
    const res = await pgPool.query("SELECT * FROM driver_shifts WHERE status = 'ACTIVE' ORDER BY shift_id DESC")
    return res.rows || []
  }

  return new Promise((resolve) => {
    sqliteDb.all("SELECT * FROM driver_shifts WHERE status = 'ACTIVE' ORDER BY shift_id DESC", (err, rows) => {
      resolve(err ? [] : rows || [])
    })
  })
}

// 14. Conductors Management
export async function getConductorsByOwner(ownerEmail) {
  const cleanEmail = (ownerEmail || '').toLowerCase().trim()
  const isRakesh = cleanEmail === 'rakeshtravels018@gmail.com' || cleanEmail === 'rakesh@gmail.com'

  const query = isRakesh
    ? `SELECT c.*, b.bus_name, b.vehicle_number
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) IN ('rakeshtravels018@gmail.com', 'rakesh@gmail.com')
       ORDER BY c.conductor_id DESC`
    : `SELECT c.*, b.bus_name, b.vehicle_number
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) = LOWER($1)
       ORDER BY c.conductor_id DESC`

  if (isPostgres()) {
    const res = await pgPool.query(query, isRakesh ? [] : [ownerEmail])
    return res.rows || []
  }

  const sqliteQuery = isRakesh
    ? `SELECT c.*, b.bus_name, b.vehicle_number
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) IN ('rakeshtravels018@gmail.com', 'rakesh@gmail.com')
       ORDER BY c.conductor_id DESC`
    : `SELECT c.*, b.bus_name, b.vehicle_number
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) = LOWER(?)
       ORDER BY c.conductor_id DESC`

  return new Promise((resolve) => {
    sqliteDb.all(sqliteQuery, isRakesh ? [] : [ownerEmail], (err, rows) => {
      resolve(err ? [] : rows || [])
    })
  })
}

export async function getConductorByPhoneAndOwner(ownerEmail, phone) {
  const cleanEmail = (ownerEmail || '').toLowerCase().trim()
  const isRakesh = cleanEmail === 'rakeshtravels018@gmail.com' || cleanEmail === 'rakesh@gmail.com'
  const cleanPhone = String(phone || '').replace(/\D/g, '')
  const tenDigitPhone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone

  const query = isRakesh
    ? `SELECT c.*, b.bus_name, b.vehicle_number, b.route_number, b.origin, b.destination, b.total_seats
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) IN ('rakeshtravels018@gmail.com', 'rakesh@gmail.com')
         AND (
           REPLACE(c.phone, ' ', '') = $1
           OR RIGHT(REPLACE(c.phone, ' ', ''), 10) = $2
         )
       LIMIT 1`
    : `SELECT c.*, b.bus_name, b.vehicle_number, b.route_number, b.origin, b.destination, b.total_seats
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) = LOWER($1)
         AND (
           REPLACE(c.phone, ' ', '') = $2
           OR RIGHT(REPLACE(c.phone, ' ', ''), 10) = $3
         )
       LIMIT 1`

  if (isPostgres()) {
    const params = isRakesh ? [cleanPhone, tenDigitPhone] : [ownerEmail, cleanPhone, tenDigitPhone]
    const res = await pgPool.query(query, params)
    return res.rows[0] || null
  }

  const sqliteQuery = isRakesh
    ? `SELECT c.*, b.bus_name, b.vehicle_number, b.route_number, b.origin, b.destination, b.total_seats
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) IN ('rakeshtravels018@gmail.com', 'rakesh@gmail.com')
         AND (
           REPLACE(c.phone, ' ', '') = ?
           OR SUBSTR(REPLACE(c.phone, ' ', ''), -10) = ?
         )
       LIMIT 1`
    : `SELECT c.*, b.bus_name, b.vehicle_number, b.route_number, b.origin, b.destination, b.total_seats
       FROM conductors c
       LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
       WHERE LOWER(c.owner_email) = LOWER(?)
         AND (
           REPLACE(c.phone, ' ', '') = ?
           OR SUBSTR(REPLACE(c.phone, ' ', ''), -10) = ?
         )
       LIMIT 1`

  return new Promise((resolve) => {
    const params = isRakesh ? [cleanPhone, tenDigitPhone] : [ownerEmail, cleanPhone, tenDigitPhone]
    sqliteDb.get(sqliteQuery, params, (err, row) => {
      resolve(err ? null : row || null)
    })
  })
}

export async function saveConductor(data) {
  if (isPostgres()) {
    const res = await pgPool.query(
      `INSERT INTO conductors (owner_email, name, phone, assigned_bus_id, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING conductor_id`,
      [data.owner_email, data.name, data.phone, data.assigned_bus_id || null, data.status || 'Active']
    )
    return { conductor_id: res.rows[0].conductor_id, ...data }
  }

  return new Promise((resolve) => {
    sqliteDb.run(
      'INSERT INTO conductors (owner_email, name, phone, assigned_bus_id, status) VALUES (?, ?, ?, ?, ?)',
      [data.owner_email, data.name, data.phone, data.assigned_bus_id || null, data.status || 'Active'],
      function (err) {
        if (err) resolve(null)
        else resolve({ conductor_id: this.lastID, ...data })
      }
    )
  })
}

export async function getConductorById(conductorId) {
  const query = `
    SELECT c.*, b.bus_name, b.vehicle_number, b.route_number, b.origin, b.destination, b.total_seats
    FROM conductors c
    LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
    WHERE c.conductor_id = $1
    LIMIT 1
  `
  if (isPostgres()) {
    const res = await pgPool.query(query, [conductorId])
    return res.rows[0] || null
  }

  const sqliteQuery = `
    SELECT c.*, b.bus_name, b.vehicle_number, b.route_number, b.origin, b.destination, b.total_seats
    FROM conductors c
    LEFT JOIN buses b ON c.assigned_bus_id = b.bus_id
    WHERE c.conductor_id = ?
    LIMIT 1
  `
  return new Promise((resolve) => {
    sqliteDb.get(sqliteQuery, [conductorId], (err, row) => {
      resolve(err ? null : row || null)
    })
  })
}

export async function updateConductorAssignedBus(conductorId, busId) {
  if (isPostgres()) {
    const res = await pgPool.query(
      'UPDATE conductors SET assigned_bus_id = $1 WHERE conductor_id = $2',
      [busId ? Number(busId) : null, Number(conductorId)]
    )
    return res.rowCount > 0
  }

  return new Promise((resolve) => {
    sqliteDb.run(
      'UPDATE conductors SET assigned_bus_id = ? WHERE conductor_id = ?',
      [busId ? Number(busId) : null, Number(conductorId)],
      function (err) {
        resolve(!err && this.changes > 0)
      }
    )
  })
}

export async function deleteConductor(conductorId, ownerEmail) {
  if (isPostgres()) {
    const res = await pgPool.query(
      'DELETE FROM conductors WHERE conductor_id = $1 AND LOWER(owner_email) = LOWER($2)',
      [conductorId, ownerEmail]
    )
    return res.rowCount > 0
  }

  return new Promise((resolve) => {
    sqliteDb.run(
      'DELETE FROM conductors WHERE conductor_id = ? AND LOWER(owner_email) = LOWER(?)',
      [conductorId, ownerEmail],
      function (err) {
        resolve(!err && this.changes > 0)
      }
    )
  })
}

// 15. Owner Activities Logging
export async function getOwnerActivities(ownerEmail, limit = 10) {
  if (isPostgres()) {
    const res = await pgPool.query(
      'SELECT * FROM owner_activities WHERE LOWER(owner_email) = LOWER($1) ORDER BY activity_id DESC LIMIT $2',
      [ownerEmail, limit]
    )
    return res.rows || []
  }

  return new Promise((resolve) => {
    sqliteDb.all(
      'SELECT * FROM owner_activities WHERE LOWER(owner_email) = LOWER(?) ORDER BY activity_id DESC LIMIT ?',
      [ownerEmail, limit],
      (err, rows) => {
        resolve(err ? [] : rows || [])
      }
    )
  })
}

export async function insertOwnerActivity(ownerEmail, actionType, title, description = '') {
  if (isPostgres()) {
    const res = await pgPool.query(
      'INSERT INTO owner_activities (owner_email, action_type, title, description) VALUES ($1, $2, $3, $4) RETURNING activity_id',
      [ownerEmail, actionType, title, description]
    )
    return res.rows[0].activity_id
  }

  return new Promise((resolve) => {
    sqliteDb.run(
      'INSERT INTO owner_activities (owner_email, action_type, title, description) VALUES (?, ?, ?, ?)',
      [ownerEmail, actionType, title, description],
      function (err) {
        if (err) resolve(null)
        else resolve(this.lastID)
      }
    )
  })
}

// 16. Aggregate Owner Dashboard
export async function getOwnerDashboardData(ownerEmail, activeBuses = {}) {
  const buses = await getBusesByOwner(ownerEmail)
  const conductors = await getConductorsByOwner(ownerEmail)
  const activities = await getOwnerActivities(ownerEmail, 10)

  const distinctRoutes = new Set(buses.map((b) => b.route_number).filter(Boolean))
  const liveCount = buses.filter((b) => {
    const active = activeBuses[b.bus_id]
    return active && (active.speed > 0 || active.active_shift || active.is_on_shift)
  }).length

  const busesWithStatus = buses.map((b) => {
    const active = activeBuses[b.bus_id]
    const isLive = Boolean(active && (active.speed > 0 || active.active_shift || active.is_on_shift))
    return {
      ...b,
      is_live: isLive,
      tracking_status: isLive ? 'Live On Shift' : 'Offline / Not Started',
    }
  })

  return {
    stats: {
      total_buses: buses.length,
      total_conductors: conductors.length,
      total_routes: distinctRoutes.size || (buses.length > 0 ? 1 : 0),
      live_buses: liveCount,
    },
    recent_activity: activities,
    buses: busesWithStatus,
    conductors,
  }
}

// ============================================================================
// VERIFIED COASTAL STOPS & PASSENGER PORTAL DATA LAYER
// ============================================================================

export const OFFICIAL_9_CORRIDOR_STOPS = [
  {
    stop_id: 1,
    stop_name: 'Mangaluru',
    stop_name_kn: 'ಮಂಗಳೂರು',
    alternative_names: 'Mangalore, Statebank, Hampankatta, Central',
    nearby_landmarks: 'DC Office, Town Hall, Nehru Maidan, Central Railway Station',
    locality: 'Statebank, Mangaluru',
    latitude: 12.8633,
    longitude: 74.8385,
  },
  {
    stop_id: 2,
    stop_name: 'Kuntikana',
    stop_name_kn: 'ಕುಂತಿಕಾನ',
    alternative_names: 'AJ Hospital, Kuntikana Circle, Derebail Cross',
    nearby_landmarks: 'AJ Hospital & Research Centre, Kuntikana Flyover, Derebail Church',
    locality: 'Kuntikana, Mangaluru',
    latitude: 12.8988,
    longitude: 74.8512,
  },
  {
    stop_id: 3,
    stop_name: 'Kulur',
    stop_name_kn: 'ಕೂಳೂರು',
    alternative_names: 'Kuloor, Kulur Bridge, Kulur Junction, Tannirbhavi Cross',
    nearby_landmarks: 'Kulur River Bridge, KIADB Industrial Area, Tannirbhavi Beach Cross',
    locality: 'Kulur, Mangaluru',
    latitude: 12.9234,
    longitude: 74.8257,
  },
  {
    stop_id: 4,
    stop_name: 'Surathkal',
    stop_name_kn: 'ಸುರತ್ಕಲ್',
    alternative_names: 'NITK Surathkal, Surathkal Junction, Surathkal Bus Stand',
    nearby_landmarks: 'NITK Surathkal Main Gate, Surathkal Railway Station, Surathkal Lighthouse',
    locality: 'Surathkal',
    latitude: 13.0068,
    longitude: 74.7954,
  },
  {
    stop_id: 5,
    stop_name: 'Mulki',
    stop_name_kn: 'ಮುಲ್ಕಿ',
    alternative_names: 'Mulki Bus Stand, Mulki Punaroor, Koluvail, Karnad',
    nearby_landmarks: 'Bappanadu Durgaparameshwari Temple, Mulki Bus Stand, Shambhavi River Bridge',
    locality: 'Mulki',
    latitude: 13.0908,
    longitude: 74.7903,
  },
  {
    stop_id: 6,
    stop_name: 'Padubidri',
    stop_name_kn: 'ಪಡುಬಿದ್ರಿ',
    alternative_names: 'Padubidre, Padubidri End Point, Blue Flag Beach Road',
    nearby_landmarks: 'Padubidri Blue Flag Beach, Padubidri Mahaganapathi Temple, Karkala Cross',
    locality: 'Padubidri',
    latitude: 13.1415,
    longitude: 74.7725,
  },
  {
    stop_id: 7,
    stop_name: 'Kaup',
    stop_name_kn: 'ಕಾಪು',
    alternative_names: 'Kapu, Kaup Light House, Kaup Beach Cross, Marigudi',
    nearby_landmarks: 'Kaup Lighthouse, Hale Mariamma Temple, Kaup Beach',
    locality: 'Kaup',
    latitude: 13.2208,
    longitude: 74.7431,
  },
  {
    stop_id: 8,
    stop_name: 'Udupi',
    stop_name_kn: 'ಉಡುಪಿ',
    alternative_names: 'Udupi City Bus Stand, Service Bus Stand, Kalsanka, Diana Circle, Sri Krishna Matha',
    nearby_landmarks: 'Sri Krishna Temple, Sri Krishna Matha, Diana Circle, Udupi Service Bus Stand, MGM College',
    locality: 'Udupi',
    latitude: 13.3409,
    longitude: 74.7421,
  },
  {
    stop_id: 9,
    stop_name: 'Kundapura',
    stop_name_kn: 'ಕುಂದಾಪುರ',
    alternative_names: 'Kundapur, Kundapura Shastri Circle, New Bus Stand, Old Bus Stand',
    nearby_landmarks: 'Shastri Circle, Kundapura New Bus Stand, Kundeshwara Temple, Kodi Beach',
    locality: 'Kundapura',
    latitude: 13.6279,
    longitude: 74.6931,
  },
]

export const VERIFIED_COASTAL_STOPS = OFFICIAL_9_CORRIDOR_STOPS

async function seedVerifiedBusStopsPg() {
  try {
    await pgPool.query('DELETE FROM bus_stops')
    for (const stop of OFFICIAL_9_CORRIDOR_STOPS) {
      await pgPool.query(
        'INSERT INTO bus_stops (stop_id, stop_name, stop_name_kn, alternative_names, nearby_landmarks, locality, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (stop_name) DO UPDATE SET stop_id = EXCLUDED.stop_id, stop_name_kn = EXCLUDED.stop_name_kn, alternative_names = EXCLUDED.alternative_names, nearby_landmarks = EXCLUDED.nearby_landmarks, locality = EXCLUDED.locality, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude',
        [
          stop.stop_id,
          stop.stop_name,
          stop.stop_name_kn,
          stop.alternative_names,
          stop.nearby_landmarks,
          stop.locality,
          stop.latitude,
          stop.longitude,
        ]
      )
    }
  } catch (err) {
    console.error('Error seeding verified stops in PostgreSQL:', err.message)
  }
}

function seedVerifiedBusStopsSqlite(cb) {
  sqliteDb.run('DELETE FROM bus_stops', () => {
    const stmt = sqliteDb.prepare(
      'INSERT OR REPLACE INTO bus_stops (stop_id, stop_name, stop_name_kn, alternative_names, nearby_landmarks, locality, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const stop of OFFICIAL_9_CORRIDOR_STOPS) {
      stmt.run(
        stop.stop_id,
        stop.stop_name,
        stop.stop_name_kn,
        stop.alternative_names,
        stop.nearby_landmarks,
        stop.locality,
        stop.latitude,
        stop.longitude
      )
    }
    stmt.finalize(() => {
      if (cb) cb()
    })
  })
}
function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function normalizeStopSearchTerm(term) {
  if (!term) return ''
  const clean = term.trim().toLowerCase()
  if (clean === 'mangalore' || clean === 'statebank') return 'mangaluru'
  if (clean === 'kundapur') return 'kundapura'
  return clean
}

// 17. Search Bus Stops (by official name, Kannada name, alternative names, or nearby landmark)
export async function searchBusStops(query) {
  const q = (query || '').trim()
  if (!q) {
    return getAllBusStops()
  }

  if (isPostgres()) {
    const pattern = `%${q}%`
    const res = await pgPool.query(
      `SELECT * FROM bus_stops
       WHERE stop_name ILIKE $1
          OR stop_name_kn ILIKE $1
          OR alternative_names ILIKE $1
          OR nearby_landmarks ILIKE $1
          OR locality ILIKE $1
       ORDER BY stop_id ASC
       LIMIT 30`,
      [pattern]
    )
    return res.rows
  }

  return new Promise((resolve, reject) => {
    const pattern = `%${q}%`
    sqliteDb.all(
      `SELECT * FROM bus_stops
       WHERE stop_name LIKE ?
          OR stop_name_kn LIKE ?
          OR alternative_names LIKE ?
          OR nearby_landmarks LIKE ?
          OR locality LIKE ?
       ORDER BY stop_id ASC
       LIMIT 30`,
      [pattern, pattern, pattern, pattern, pattern],
      (err, rows) => {
        if (err) reject(err)
        else resolve(rows || [])
      }
    )
  })
}

// 18. Get Nearby Bus Stops (Optional On-Demand Location)
export async function getNearbyBusStops(latitude, longitude, radiusKm = 15) {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (isNaN(lat) || isNaN(lng)) return []

  const stops = await getAllBusStops()
  const withDistance = stops.map((stop) => {
    const dist = calculateHaversineKm(lat, lng, stop.latitude, stop.longitude)
    return {
      ...stop,
      distance_km: Number(dist.toFixed(1)),
    }
  })

  withDistance.sort((a, b) => a.distance_km - b.distance_km)
  return withDistance.filter((s) => s.distance_km <= radiusKm).slice(0, 15)
}

// 19. Get All Verified Bus Stops
export async function getAllBusStops() {
  if (isPostgres()) {
    const res = await pgPool.query('SELECT * FROM bus_stops ORDER BY stop_id ASC')
    return res.rows
  }

  return new Promise((resolve, reject) => {
    sqliteDb.all('SELECT * FROM bus_stops ORDER BY stop_id ASC', (err, rows) => {
      if (err) reject(err)
      else resolve(rows || [])
    })
  })
}

// 20. Search Buses By Journey (Time-Based & Real-Time Tracking)
// CRITICAL: Absolutely NO ticket fare, ticket price, fees or payment fields anywhere
export async function searchBusesByJourney(fromQuery, toQuery, activeBuses = {}, desiredTime = null) {
  const cleanFrom = normalizeStopSearchTerm(fromQuery)
  const cleanTo = normalizeStopSearchTerm(toQuery)

  if (!cleanFrom || !cleanTo) {
    return []
  }

  // 1. Enforce that search is strictly within the 9 official corridor stops
  const fromStop = OFFICIAL_9_CORRIDOR_STOPS.find((s) => {
    const norm = normalizeStopSearchTerm(s.stop_name)
    return norm === cleanFrom || s.stop_name.toLowerCase() === fromQuery.toLowerCase().trim()
  })
  const toStop = OFFICIAL_9_CORRIDOR_STOPS.find((s) => {
    const norm = normalizeStopSearchTerm(s.stop_name)
    return norm === cleanTo || s.stop_name.toLowerCase() === toQuery.toLowerCase().trim()
  })

  // Both stops must belong to the 9 official corridor stops
  if (!fromStop || !toStop) {
    return []
  }

  // Reject reverse journey or identical stop (Boarding must precede Destination)
  if (fromStop.stop_id >= toStop.stop_id) {
    return []
  }

  const buses = await getBuses()
  const matched = []

  const now = Date.now()
  const currentMinutesIST = getCurrentMinutesIST(now)

  let desiredMinutes = null
  if (desiredTime) {
    const cleanTime = String(desiredTime).trim().toLowerCase()
    if (cleanTime === 'now') {
      desiredMinutes = currentMinutesIST
    } else {
      desiredMinutes = parseTimeToMinutes(desiredTime)
    }
  }

  for (const bus of buses) {
    // Strict Project Requirement: Must belong to the fixed corridor Mangaluru -> Kundapura
    if (bus.origin !== 'Mangaluru' || bus.destination !== 'Kundapura') {
      continue
    }

    // Must have an active assigned conductor in conductors table
    let conductor = null
    if (isPostgres()) {
      const cRes = await pgPool.query(
        "SELECT conductor_id, name, phone, status FROM conductors WHERE assigned_bus_id = $1 AND (status = 'Active' OR status IS NULL) LIMIT 1",
        [bus.bus_id]
      )
      conductor = cRes.rows[0] || null
    } else {
      conductor = await new Promise((resolve) => {
        sqliteDb.get(
          "SELECT conductor_id, name, phone, status FROM conductors WHERE assigned_bus_id = ? AND (status = 'Active' OR status IS NULL) LIMIT 1",
          [bus.bus_id],
          (err, row) => resolve(err ? null : row || null)
        )
      })
    }

    if (!conductor) {
      continue
    }

    let stops = await getBusRouteStops(bus.bus_id)
    if (!stops || stops.length < 2) {
      continue
    }

    const fromIdx = stops.findIndex((s) => {
      const name = normalizeStopSearchTerm(s.stop_name)
      return name === cleanFrom || name.includes(cleanFrom) || cleanFrom.includes(name)
    })

    const toIdx = stops.findIndex((s) => {
      const name = normalizeStopSearchTerm(s.stop_name)
      return name === cleanTo || name.includes(cleanTo) || cleanTo.includes(name)
    })

    // Journey Requirement: FROM occurs BEFORE TO along the same route
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
      const boardingStop = stops[fromIdx]
      const destinationStop = stops[toIdx]

      const activeData = activeBuses[bus.bus_id] || {}
      const lastTs = activeData.timestamp ? new Date(activeData.timestamp).getTime() : (activeData.last_telemetry_at || 0)
      const isShiftActive = Boolean(activeData.is_on_shift || activeData.active_shift)
      const hasLiveGps = Boolean(isShiftActive && activeData.latitude && activeData.longitude)

      const elapsedMs = lastTs > 0 ? (now - lastTs) : 0
      const isStale = isShiftActive && (elapsedMs >= 120000 && lastTs > 0)

      // Owner configured schedule
      const boardingPlannedTime = boardingStop.planned_arrival || bus.departure_time || '07:00 AM'
      const destinationPlannedTime = destinationStop.planned_arrival || '08:30 AM'
      const plannedMinutes = parseTimeToMinutes(boardingPlannedTime)

      let trackingStatus = 'SCHEDULED'
      let isLive = false
      let liveEtaMinutes = null
      let expectedArrivalMinutes = plannedMinutes
      let expectedArrivalTime = boardingPlannedTime
      let searchCategory = 'SCHEDULED'
      let distanceKm = null

      if (hasLiveGps) {
        const busLat = Number(activeData.latitude)
        const busLng = Number(activeData.longitude)
        const busSpeed = Number(activeData.speed) || 0

        const progress = calculateLiveBusProgressAndEta(busLat, busLng, busSpeed, fromStop, lastTs)

        // Exclude buses that have already passed the selected stop
        if (progress.has_passed) {
          if (desiredMinutes !== null) {
            continue
          }
        }

        distanceKm = progress.distance_km
        liveEtaMinutes = progress.eta_minutes
        searchCategory = progress.category // 'PRESENT' | 'APPROACHING' | 'EN_ROUTE' | 'PASSED'

        if (isStale) {
          trackingStatus = 'LOCATION STALE'
          isLive = false
        } else if (progress.is_approaching) {
          trackingStatus = 'APPROACHING'
          isLive = true
        } else {
          trackingStatus = 'LIVE'
          isLive = true
        }

        // Expected arrival time based on actual live location and speed
        expectedArrivalMinutes = (currentMinutesIST + liveEtaMinutes) % 1440
        expectedArrivalTime = formatMinutesToTime(expectedArrivalMinutes)

        // When desired time is specified:
        // 1. Buses already present at the selected stop -> ALWAYS SHOW
        // 2. Buses approaching the stop -> ALWAYS SHOW
        // 3. Buses behind the stop and travelling towards it, expected to arrive after the selected time
        if (desiredMinutes !== null) {
          if (searchCategory === 'EN_ROUTE' && expectedArrivalMinutes < desiredMinutes) {
            continue
          }
        }
      } else {
        // Live GPS is unavailable -> Use owner-configured schedules, clearly labelled SCHEDULED
        trackingStatus = 'SCHEDULED'
        isLive = false
        searchCategory = 'SCHEDULED'
        expectedArrivalMinutes = plannedMinutes
        expectedArrivalTime = boardingPlannedTime

        // If desired time is specified, exclude scheduled buses that have already passed the selected stop
        if (desiredMinutes !== null) {
          if (plannedMinutes < desiredMinutes) {
            continue
          }
        }
      }

      const scheduleComparison = hasLiveGps
        ? calculateScheduleAdherence(expectedArrivalMinutes, plannedMinutes)
        : { status: 'SCHEDULED', delay_minutes: 0, label: 'Scheduled' }

      matched.push({
        bus_id: bus.bus_id,
        bus_name: bus.bus_name,
        vehicle_number: bus.vehicle_number,
        route_number: bus.route_number,
        service_type: bus.service_type || 'Non AC',
        origin: bus.origin,
        destination: bus.destination,
        route_name: `${bus.origin} ➔ ${bus.destination}`,
        total_seats: bus.total_seats || 45,
        photo_url: bus.photo_url || null,
        boarding_stop: boardingStop.stop_name,
        boarding_stop_order: boardingStop.stop_order,
        boarding_planned_time: boardingPlannedTime,
        destination_stop: destinationStop.stop_name,
        destination_stop_order: destinationStop.stop_order,
        destination_planned_time: destinationPlannedTime,
        journey_duration: bus.journey_duration || '1 hour 35 minutes',
        tracking_status: trackingStatus,
        is_live: isLive,
        live_eta_minutes: liveEtaMinutes,
        expected_arrival_time: expectedArrivalTime,
        expected_arrival_minutes: expectedArrivalMinutes,
        search_category: searchCategory,
        distance_to_stop_km: distanceKm,
        schedule_adherence: scheduleComparison.status,
        adherence_label: scheduleComparison.label,
        delay_minutes: scheduleComparison.delay_minutes,
        last_update: activeData.timestamp ? formatToIST(activeData.timestamp, 'time-only') : null,
        last_update_utc: activeData.timestamp ? new Date(activeData.timestamp).toISOString() : null,
        latitude: hasLiveGps ? activeData.latitude : null,
        longitude: hasLiveGps ? activeData.longitude : null,
        speed: hasLiveGps ? (activeData.speed || 0) : 0,
        next_stop: activeData.next_stop || null,
        conductor_name: conductor.name,
        conductor_phone: conductor.phone,
        stops,
      })
    }
  }

  // Sort results by expected arrival time
  matched.sort((a, b) => {
    const timeDiff = a.expected_arrival_minutes - b.expected_arrival_minutes
    if (timeDiff !== 0) return timeDiff
    if (a.is_live && !b.is_live) return -1
    if (!a.is_live && b.is_live) return 1
    return 0
  })

  return matched
}
// 21. Get Bus Route With Enriched Stops & Landmarks
export async function getBusRouteWithStops(busId) {
  const bus = await getBusById(busId)
  if (!bus) return null

  const routeStops = await getBusRouteStops(busId)
  const allVerified = await getAllBusStops()
  const map = {}
  allVerified.forEach((s) => {
    map[s.stop_name.toLowerCase()] = s
  })

  const enriched = (routeStops || []).map((s) => {
    const meta = map[s.stop_name.toLowerCase()] || {}
    return {
      ...s,
      stop_name_kn: meta.stop_name_kn || s.stop_name,
      nearby_landmarks: meta.nearby_landmarks || '',
      locality: meta.locality || '',
      latitude: meta.latitude || null,
      longitude: meta.longitude || null,
    }
  })

  return {
    ...bus,
    stops: enriched,
  }
}

// 22. Passenger Feedback Persistence
export async function savePassengerFeedback({ name, email, category, rating, message }) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('Feedback message is required.')
  }
  const cleanName = (name || 'Anonymous Passenger').trim().slice(0, 100)
  const cleanEmail = (email || '').trim().slice(0, 120)
  const cleanCategory = (category || 'General').trim().slice(0, 50)
  const cleanRating = Math.min(Math.max(Number(rating) || 5, 1), 5)
  const cleanMsg = message.trim().slice(0, 2000)

  if (isPostgres()) {
    const res = await pgPool.query(
      `INSERT INTO passenger_feedback (name, email, category, rating, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [cleanName, cleanEmail, cleanCategory, cleanRating, cleanMsg]
    )
    return {
      id: res.rows[0].id,
      name: cleanName,
      email: cleanEmail,
      category: cleanCategory,
      rating: cleanRating,
      message: cleanMsg,
      created_at: res.rows[0].created_at,
    }
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(
      `INSERT INTO passenger_feedback (name, email, category, rating, message) VALUES (?, ?, ?, ?, ?)`,
      [cleanName, cleanEmail, cleanCategory, cleanRating, cleanMsg],
      function (err) {
        if (err) reject(err)
        else {
          resolve({
            id: this.lastID,
            name: cleanName,
            email: cleanEmail,
            category: cleanCategory,
            rating: cleanRating,
            message: cleanMsg,
            created_at: new Date().toISOString(),
          })
        }
      }
    )
  })
}

// 23. Get Recent Passenger Feedback
export async function getPassengerFeedback(limit = 20) {
  const max = Math.min(Number(limit) || 20, 100)
  if (isPostgres()) {
    const res = await pgPool.query(
      'SELECT * FROM passenger_feedback ORDER BY created_at DESC LIMIT $1',
      [max]
    )
    return res.rows
  }

  return new Promise((resolve, reject) => {
    sqliteDb.all(
      'SELECT * FROM passenger_feedback ORDER BY created_at DESC LIMIT ?',
      [max],
      (err, rows) => {
        if (err) reject(err)
        else resolve(rows || [])
      }
    )
  })
}

// ============================================================================
// 24. REAL GMAIL OTP PERSISTENCE (SECURE HASHING & ZERO LOGGING)
// ============================================================================

/**
 * Persists an email OTP secure hash to database.
 * Automatically marks all previous active/unused OTPs for this email as used/invalidated.
 */
export async function saveEmailOtp({ email, otpHash, expiresAt, createdAt = Date.now() }) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const exp = Number(expiresAt)
  const created = Number(createdAt)

  if (isPostgres()) {
    await pgPool.query(
      'UPDATE email_otps SET used = 1 WHERE LOWER(email) = LOWER($1) AND used = 0',
      [cleanEmail]
    )
    const res = await pgPool.query(
      `INSERT INTO email_otps (email, otp_code, otp_hash, expires_at, attempts, used, created_at)
       VALUES ($1, $2, $3, $4, 0, 0, $5)
       RETURNING id, email, expires_at, attempts, used, created_at`,
      [cleanEmail, '[SECURE_HASHED]', otpHash, exp, created]
    )
    return res.rows[0]
  }

  return new Promise((resolve, reject) => {
    sqliteDb.serialize(() => {
      sqliteDb.run(
        'UPDATE email_otps SET used = 1 WHERE LOWER(email) = LOWER(?) AND used = 0',
        [cleanEmail],
        (updateErr) => {
          if (updateErr) return reject(updateErr)
          sqliteDb.run(
            `INSERT INTO email_otps (email, otp_code, otp_hash, expires_at, attempts, used, created_at)
             VALUES (?, ?, ?, ?, 0, 0, ?)`,
            [cleanEmail, '[SECURE_HASHED]', otpHash, exp, created],
            function (insertErr) {
              if (insertErr) return reject(insertErr)
              resolve({
                id: this.lastID,
                email: cleanEmail,
                expires_at: exp,
                attempts: 0,
                used: 0,
                created_at: created,
              })
            }
          )
        }
      )
    })
  })
}

/**
 * Retrieves the most recent active (unused) OTP record for a given email address.
 */
export async function getLatestEmailOtp(email) {
  const cleanEmail = String(email || '').trim().toLowerCase()

  if (isPostgres()) {
    const res = await pgPool.query(
      `SELECT * FROM email_otps WHERE LOWER(email) = LOWER($1) AND used = 0 ORDER BY id DESC LIMIT 1`,
      [cleanEmail]
    )
    return res.rows?.[0] || null
  }

  return new Promise((resolve, reject) => {
    sqliteDb.get(
      `SELECT * FROM email_otps WHERE LOWER(email) = LOWER(?) AND used = 0 ORDER BY id DESC LIMIT 1`,
      [cleanEmail],
      (err, row) => {
        if (err) reject(err)
        else resolve(row || null)
      }
    )
  })
}

/**
 * Increments the verification attempt counter on an OTP record.
 */
export async function incrementOtpAttempts(id) {
  const otpId = Number(id)
  if (isPostgres()) {
    await pgPool.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1', [otpId])
    return true
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(
      'UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?',
      [otpId],
      (err) => {
        if (err) reject(err)
        else resolve(true)
      }
    )
  })
}

/**
 * Marks an OTP record as used (single-use enforcement).
 */
export async function markEmailOtpUsed(id) {
  const otpId = Number(id)
  if (isPostgres()) {
    await pgPool.query('UPDATE email_otps SET used = 1 WHERE id = $1', [otpId])
    return true
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(
      'UPDATE email_otps SET used = 1 WHERE id = ?',
      [otpId],
      (err) => {
        if (err) reject(err)
        else resolve(true)
      }
    )
  })
}

/**
 * Invalidates all active OTPs for an email address (e.g., upon resend or duty conclusion).
 */
export async function invalidatePendingOtps(email) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (isPostgres()) {
    await pgPool.query('UPDATE email_otps SET used = 1 WHERE LOWER(email) = LOWER($1) AND used = 0', [cleanEmail])
    return true
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(
      'UPDATE email_otps SET used = 1 WHERE LOWER(email) = LOWER(?) AND used = 0',
      [cleanEmail],
      (err) => {
        if (err) reject(err)
        else resolve(true)
      }
    )
  })
}
