import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof drizzle> | undefined
}

function createDb() {
  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,            // One connection per serverless invocation
    idle_timeout: 20,  // Release idle connections quickly
    connect_timeout: 10,
    prepare: false,    // Required: Supabase transaction pooler (PgBouncer) doesn't support prepared statements
  })
  return drizzle(client, { schema })
}

export const db = global.__db ?? createDb()

if (process.env.NODE_ENV !== 'production') {
  global.__db = db
}
