import { getSqliteDb, initDB, isPostgres, getDatabaseType } from '../db.js'

async function inspect() {
  await initDB()
  console.log(`\n========================================`)
  console.log(`Database Engine: ${getDatabaseType()}`)
  console.log(`Host: ${process.env.USE_POSTGRES === 'true' ? (process.env.PGHOST || 'localhost') : 'Local File (transit.db)'}`)
  console.log(`========================================\n`)

  const db = getSqliteDb()

  db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;", async (err, tables) => {
    if (err) {
      console.error('Error fetching tables:', err)
      process.exit(1)
    }

    console.log(`Found ${tables.length} tables in database:\n`)

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

    // Show sample buses
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
