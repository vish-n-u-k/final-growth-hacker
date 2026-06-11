import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof drizzle> | undefined
}

function createDb() {
  const client = postgres(process.env.DATABASE_URL!)
  return drizzle(client, { schema })
}

export const db = global.__db ?? createDb()

if (process.env.NODE_ENV !== 'production') {
  global.__db = db
}
