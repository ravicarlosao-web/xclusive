import "dotenv/config";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

import { pool, db } from "@workspace/db";

async function testConnection() {
  console.log("Testing Neon DB Connection...");
  console.log("Database URL configured:", process.env.DATABASE_URL ? "YES (starts with " + process.env.DATABASE_URL.substring(0, 15) + "...)" : "NO");
  try {
    const res = await pool.query("SELECT current_database(), current_user, version();");
    console.log("✅ Connection Successful! Details:", res.rows[0]);
  } catch (err) {
    console.error("❌ Connection failed:", err);
  } finally {
    await pool.end();
  }
}

testConnection();
