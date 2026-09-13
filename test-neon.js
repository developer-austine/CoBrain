const { Pool } = require('pg');

const connectionString = process.env.NEON_DATABASE_URL;
console.log('Testing Neon connection...');
console.log('Connection string exists:', !!connectionString);

if (!connectionString) {
  console.log('No NEON_DATABASE_URL in process env');
  require('dotenv').config();
  const envUrl = process.env.NEON_DATABASE_URL;
  console.log('After loading .env, connection string exists:', !!envUrl);
}

const pool = new Pool({ connectionString });

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Connection failed:', err.message);
  } else {
    console.log('Connection successful! Current time:', res.rows[0]);
  }
  pool.end();
});
