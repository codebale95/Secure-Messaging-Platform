const pool = require('./db');

console.log(process.env.DATABASE_URL);

async function test() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('Database Connected!');
        console.log(result.rows[0]);
    } catch (err) {
        console.error(err);
    }

    process.exit();
}

test();