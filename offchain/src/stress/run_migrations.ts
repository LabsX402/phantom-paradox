#!/usr/bin/env ts-node
/**
 * Run database migrations
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const connectionString = process.env.PG_CONNECTION_STRING || 
  'postgresql://postgres:1234@localhost:5432/phantomgrid_test';

async function runMigration(pool: Pool, filepath: string): Promise<void> {
  console.log(`📝 Running ${path.basename(filepath)}...`);
  const sql = fs.readFileSync(filepath, 'utf8');
  
  try {
    await pool.query(sql);
    console.log(`   ✅ Migration completed`);
  } catch (error: any) {
    // Ignore "already exists" errors
    if (error.message.includes('already exists') || error.code === '42P07') {
      console.log(`   ⚠️  Tables already exist (skipping)`);
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log('🔧 Running database migrations...\n');
  
  const pool = new Pool({ connectionString });
  
  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');
    
    // Run migrations
    const migrationsDir = path.resolve(__dirname, '../../migrations');
    const migration1 = path.join(migrationsDir, '001_initial_schema.sql');
    const migration2 = path.join(migrationsDir, '002_compression.sql');
    
    if (fs.existsSync(migration1)) {
      await runMigration(pool, migration1);
    } else {
      console.log(`❌ Migration file not found: ${migration1}`);
    }
    
    if (fs.existsSync(migration2)) {
      await runMigration(pool, migration2);
    } else {
      console.log(`⚠️  Optional migration not found: ${migration2}`);
    }
    
    console.log('\n✅ All migrations completed!');
    console.log('\n🚀 Ready to run stress tests!');
    
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

