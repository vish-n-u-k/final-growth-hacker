import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof drizzle> | undefined
}

function createDb() {
  const client = postgres(process.env.DATABASE_URL!, {
    max: 5,            // Allow parallel queries within a single request (PgBouncer handles pooling)
    idle_timeout: 0,   // Never close idle connections — long-running analysis routes (up to 300s) need the connection to stay alive
    connect_timeout: 30,
    prepare: false,    // Required: Supabase transaction pooler (PgBouncer) doesn't support prepared statements
  })
  return drizzle(client, { schema })
}

export const db = global.__db ?? createDb()

if (process.env.NODE_ENV !== 'production') {
  global.__db = db
}
