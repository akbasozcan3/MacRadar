require('./load-backend-env');
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

client.connect()
  .then(() => {
    console.log('DB bağlantısı kuruldu');
    return client.query('SELECT id, username FROM users');
  })
  .then(r => {
    console.log('Kullanıcılar:', r.rows.length);
    r.rows.forEach(u => console.log(' -', u.id, u.username));
    return client.query('SELECT id, user_id, is_live FROM posts');
  })
  .then(r => {
    console.log('Postlar:', r.rows.length);
    r.rows.forEach(p => console.log(' -', p.id, 'user:', p.user_id, 'is_live:', p.is_live));
    if (r.rows.length === 0) {
      console.log('Zaten 0 post var, yapacak bir şey yok.');
      return client.end();
    }
    console.log('\nTüm postlar siliniyor...');
    return client.query('DELETE FROM posts').then(del => {
      console.log('Silinen satır:', del.rowCount);
      return client.end();
    });
  })
  .catch(e => { console.error('HATA:', e.message); process.exit(1); });
