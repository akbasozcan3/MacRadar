require('./load-backend-env');
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

client.connect()
  .then(() => client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"))
  .then(r => {
    console.log('Tablolar:', r.rows.map(x => x.table_name).join(', '));
    return client.query('SELECT COUNT(*) as count FROM posts');
  })
  .then(r => {
    console.log('Toplam post:', r.rows[0].count);
    return client.query('SELECT u.username, COUNT(p.id) as post_count FROM users u LEFT JOIN posts p ON p.user_id = u.id GROUP BY u.id, u.username');
  })
  .then(r => {
    console.log('Kullanici bazinda postlar:');
    r.rows.forEach(row => console.log(' -', row.username, ':', row.post_count));
    return client.end();
  })
  .catch(e => { console.error('HATA:', e.message); process.exit(1); });
