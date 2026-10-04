import "dotenv/config"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { neon } from "@neondatabase/serverless"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is missing from .env")

const sql = neon(databaseUrl)
for (const file of ["db/migrations/0001_google_connections.sql", "db/migrations/0002_agent_tables.sql"]) {
  const contents = await readFile(resolve(process.cwd(), file), "utf8")
  const statements = contents.split(";").map((statement) => statement.trim()).filter(Boolean)
  for (const statement of statements) await sql.query(statement)
}

console.log("Google connection and saved-agent tables are ready.")
