require('./load-backend-env');
const { Client } = require('pg');

const dbUrl = process.env.DATABASE_URL || 'postgres://macradar:macradar@localhost:5432/macradar?sslmode=disable';
console.log('DB URL:', dbUrl);

const client = new Client({ connectionString: dbUrl });

client.connect()
  .then(() => {
    console.log('Bağlantı başarılı');
    return client.query('SELECT COUNT(*) as count FROM posts');
  })
  .then(r => {
    const count = parseInt(r.rows[0].count);
    console.log('Mevcut post sayısı:', count);
    if (count === 0) {
      console.log('Zaten 0 post var.');
      return client.end();
    }
    console.log('Tüm postlar siliniyor...');
    return client.query('DELETE FROM posts')
      .then(del => {
        console.log('Silindi:', del.rowCount, 'satır');
        return client.end();
      });
  })
  .catch(e => {
    console.error('HATA:', e.message);
    process.exit(1);
  });
