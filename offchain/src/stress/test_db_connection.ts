#!/usr/bin/env ts-node
/**
 * Quick database connection test with progress
 */

import { Pool } from 'pg';

const connectionStrings = [
  process.env.PG_CONNECTION_STRING,
  'postgresql://postgres:postgres@localhost:5432/phantomgrid_test',
  'postgresql://postgres:postgres@127.0.0.1:5432/phantomgrid_test',
  'postgresql://localhost:5432/phantomgrid_test',
];

async function testConnection(connString: string, index: number): Promise<boolean> {
  process.stdout.write(`\r🔍 Testing connection ${index + 1}/${connectionStrings.length}...`);
  
  const pool = new Pool({ connectionString: connString });
  
  try {
    const result = await Promise.race([
      pool.query('SELECT 1 as test'),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 3000)
      )
    ]) as any;
    
    await pool.end();
    return true;
  } catch (error: any) {
    await pool.end().catch(() => {});
    return false;
  }
}

async function main() {
  console.log('🔍 Testing PostgreSQL connections...\n');
  
  for (let i = 0; i < connectionStrings.length; i++) {
    const connString = connectionStrings[i];
    if (!connString) continue;
    
    const success = await testConnection(connString, i);
    
    if (success) {
      console.log(`\n✅ Connection successful!`);
      console.log(`   Using: ${connString.replace(/:[^:@]+@/, ':****@')}`);
      console.log(`\n💡 Set this in your environment:`);
      console.log(`   $env:PG_CONNECTION_STRING="${connString}"`);
      process.exit(0);
    }
  }
  
  console.log(`\n❌ All connection attempts failed`);
  console.log(`\n💡 To fix:`);
  console.log(`   1. Start PostgreSQL: net start postgresql-x64-XX`);
  console.log(`   2. Or use Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres`);
  console.log(`   3. Create database: CREATE DATABASE phantomgrid_test;`);
  console.log(`   4. Run migrations: psql -U postgres -d phantomgrid_test -f migrations/001_initial_schema.sql`);
  
  process.exit(1);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

