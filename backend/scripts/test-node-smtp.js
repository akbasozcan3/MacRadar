require('./load-backend-env');

const { sendVerificationCodeMail } = require('../node/lib/mailer');

async function main() {
  const targetEmail = String(
    process.env.SMTP_TEST_TO || process.argv[2] || process.env.SMTP_USER || '',
  )
    .trim()
    .toLowerCase();

  if (!targetEmail.includes('@')) {
    throw new Error(
      'SMTP test hedefi bulunamadi. SMTP_TEST_TO env veya komut argumani verin.',
    );
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await sendVerificationCodeMail({
    code,
    email: targetEmail,
    expiresAt,
    fullName: 'MacRadar SMTP Test',
  });

  console.log(
    `[smtp-test] OK -> ${targetEmail} adresine test maili gonderildi. Kod: ${code}`,
  );
}

main().catch(error => {
  const reason = String(error?.code || error?.message || error);
  console.error(`[smtp-test] FAIL -> ${reason}`);
  process.exit(1);
});

