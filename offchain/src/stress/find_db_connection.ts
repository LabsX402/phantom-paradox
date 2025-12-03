#!/usr/bin/env ts-node
/**
 * Find correct PostgreSQL connection string
 */

import { Pool } from 'pg';

const commonPasswords = ['postgres', '', 'admin', 'root', 'password', '123456'];
const commonUsers = ['postgres', 'admin', 'root'];

async function testConnection(user: string, password: string, database: string = 'postgres'): Promise<boolean> {
  const connString = `postgresql://${user}:${password}@localhost:5432/${database}`;
  const pool = new Pool({ connectionString: connString });
  
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
    ]);
    await pool.end();
    return true;
  } catch {
    await pool.end().catch(() => {});
    return false;
  }
}

async function main() {
  console.log('🔍 Testing PostgreSQL connections...\n');
  
  for (const user of commonUsers) {
    for (const password of commonPasswords) {
      process.stdout.write(`\rTesting: ${user} / ${password || '(empty)'}...`);
      
      // Try default postgres database first
      const works = await testConnection(user, password, 'postgres');
      
      if (works) {
        console.log(`\n\n✅ Connection successful!`);
        console.log(`   User: ${user}`);
        console.log(`   Password: ${password || '(empty)'}`);
        console.log(`   Database: postgres`);
        console.log(`\n💡 Set this in your environment:`);
        console.log(`   $env:PG_CONNECTION_STRING="postgresql://${user}:${password}@localhost:5432/phantomgrid_test"`);
        console.log(`\n💡 Then create the database:`);
        console.log(`   psql -U ${user} -d postgres -c "CREATE DATABASE phantomgrid_test;"`);
        process.exit(0);
      }
    }
  }
  
  console.log(`\n\n❌ Could not find working connection`);
  console.log(`\n💡 Please provide:`);
  console.log(`   1. PostgreSQL username`);
  console.log(`   2. PostgreSQL password`);
  console.log(`   3. Or set: $env:PG_CONNECTION_STRING="postgresql://user:pass@localhost:5432/phantomgrid_test"`);
  process.exit(1);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

