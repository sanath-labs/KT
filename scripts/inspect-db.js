import 'dotenv/config'
import pg from 'pg'
import { getSqliteDb, initDB, isPostgres, getDatabaseType } from '../db.js'

async function inspect() {
  await initDB()
  const dbType = getDatabaseType()
  const host = process.env.USE_POSTGRES === 'true'
    ? `${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432} / ${process.env.PGDATABASE || 'karavali_transit_db'}`
    : 'Local File (transit.db)'

  console.log(`\n========================================`)
  console.log(`Database Engine: ${dbType}`)
  console.log(`Host: ${host}`)
  console.log(`========================================\n`)

  if (isPostgres()) {
    const pool = new pg.Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: String(process.env.PGPASSWORD || ''),
      database: process.env.PGDATABASE || 'karavali_transit_db',
    })

    try {
      const res = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `)

      console.log(`Found ${res.rows.length} tables in PostgreSQL database:\n`)

      for (const row of res.rows) {
        const tableName = row.table_name
        const countRes = await pool.query(`SELECT COUNT(*) as count FROM "${tableName}";`)
        const colRes = await pool.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position;
        `, [tableName])

        const cols = colRes.rows.map(c => `${c.column_name} (${c.data_type})`).join(', ')
        console.log(`📋 Table: ${tableName.toUpperCase()}  [${countRes.rows[0].count} rows]`)
        console.log(`   Columns: ${cols}`)
        console.log('')
      }

      const sample = await pool.query('SELECT bus_id, bus_name, vehicle_number, route_number, origin, destination FROM buses LIMIT 5;')
      if (sample.rows.length > 0) {
        console.log('🚍 Sample Buses Table Data:')
        console.table(sample.rows)
      }
    } catch (err) {
      console.error('Error querying PostgreSQL tables:', err.message)
    } finally {
      await pool.end()
      process.exit(0)
    }
    return
  }

  // SQLite Fallback
  const db = getSqliteDb()
  db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;", async (err, tables) => {
    if (err) {
      console.error('Error fetching tables:', err)
      process.exit(1)
    }

    console.log(`Found ${tables.length} tables in SQLite database:\n`)

    for (const { name } of tables) {
      await new Promise((resolve) => {
        db.all(`PRAGMA table_info(${name});`, (err, cols) => {
          db.get(`SELECT COUNT(*) as count FROM ${name};`, (err2, countRow) => {
            const colNames = (cols || []).map(c => `${c.name} (${c.type})`).join(', ')
            console.log(`📋 Table: ${name.toUpperCase()}  [${countRow?.count ?? 0} rows]`)
            console.log(`   Columns: ${colNames}`)
            console.log('')
            resolve()
          })
        })
      })
    }

    db.all("SELECT bus_id, bus_name, vehicle_number, route_number, origin, destination FROM buses LIMIT 5;", (err, sampleBuses) => {
      if (!err && sampleBuses && sampleBuses.length > 0) {
        console.log('🚍 Sample Buses Table Data:')
        console.table(sampleBuses)
      }
      process.exit(0)
    })
  })
}

inspect()
