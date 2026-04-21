/**
 * Inserts one incoming follow request + one pending Yakındakiler (street friend) request
 * for a target user so the profile cards show non-zero counts (Go + Postgres).
 *
 * Prereqs: DATABASE_URL (via repo .env or backend/.env), `pg` installed (backend devDependency).
 *
 * Usage (PowerShell):
 *   cd backend
 *   $env:TARGET_EMAIL="you@example.com"; node scripts/seed-incoming-profile-requests.js
 *
 * Or by username:
 *   $env:TARGET_USERNAME="yourhandle"; $env:REQUESTER_USERNAME="otheruser"; node scripts/seed-incoming-profile-requests.js
 *
 * Notes:
 * - Follow requests only appear in profile request summary when the TARGET account is private
 *   (see ProfileRequestSummaryByUserID in Go). This script sets is_private_account = true on the target.
 * - Street friendships require user_a_id < user_b_id (ordered pair).
 */

require('./load-backend-env');
const { Client } = require('pg');

function die(message) {
  console.error(message);
  process.exit(1);
}

function orderedPair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    die('DATABASE_URL is not set. Add it to .env (repo root or backend/.env).');
  }

  const targetEmail = (process.env.TARGET_EMAIL || '').trim();
  const targetUsername = (process.env.TARGET_USERNAME || '').trim();
  const requesterUsername = (process.env.REQUESTER_USERNAME || '').trim();

  if (!targetEmail && !targetUsername) {
    die(
      'Set TARGET_EMAIL or TARGET_USERNAME to your MacRadar account (the user who should receive requests).',
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  let target;
  if (targetEmail) {
    const r = await client.query(
      'select id, username, email from users where lower(email) = lower($1) limit 1',
      [targetEmail],
    );
    target = r.rows[0];
  } else {
    const r = await client.query(
      'select id, username, email from users where lower(username) = lower($1) limit 1',
      [targetUsername],
    );
    target = r.rows[0];
  }

  if (!target) {
    await client.end();
    die('Target user not found.');
  }

  let requester;
  if (requesterUsername) {
    const r = await client.query(
      'select id, username from users where lower(username) = lower($1) limit 1',
      [requesterUsername],
    );
    requester = r.rows[0];
  } else {
    const r = await client.query(
      `select id, username from users
       where id <> $1
       order by created_at asc nulls last
       limit 1`,
      [target.id],
    );
    requester = r.rows[0];
  }

  if (!requester) {
    await client.end();
    die('No requester user found. Create another account or set REQUESTER_USERNAME.');
  }

  if (requester.id === target.id) {
    await client.end();
    die('Requester and target must be different users.');
  }

  await client.query(
    'update users set is_private_account = true, updated_at = now() where id = $1',
    [target.id],
  );

  const fr = await client.query(
    `insert into follow_requests (requester_id, target_user_id)
     values ($1, $2)
     on conflict (requester_id, target_user_id) do nothing
     returning requester_id, target_user_id`,
    [requester.id, target.id],
  );

  const [userA, userB] = orderedPair(requester.id, target.id);
  const sf = await client.query(
    `insert into street_friendships (
       user_a_id, user_b_id, requested_by, status, created_at, updated_at
     )
     values ($1, $2, $3, 'pending', now(), now())
     on conflict (user_a_id, user_b_id)
     do update set
       status = 'pending',
       requested_by = excluded.requested_by,
       accepted_at = null,
       updated_at = now()
     returning user_a_id, user_b_id, requested_by, status`,
    [userA, userB, requester.id],
  );

  const summary = await client.query(
    `select
       (select count(*)::bigint
        from follow_requests fr
        join users u2 on u2.id = fr.target_user_id
        where fr.target_user_id = $1
          and coalesce(u2.is_private_account, false) = true) as follow_requests_count,
       (select count(*)::bigint
        from street_friendships sf
        where sf.status = 'pending'
          and (sf.user_a_id = $1 or sf.user_b_id = $1)
          and coalesce(sf.requested_by, '') <> ''
          and sf.requested_by <> $1) as street_requests_count`,
    [target.id],
  );

  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        target: { id: target.id, username: target.username },
        requester: { id: requester.id, username: requester.username },
        followRequestInserted: fr.rowCount > 0,
        streetFriendshipUpserted: sf.rowCount > 0,
        profileSummaryPreview: summary.rows[0],
        hint: 'Uygulamada profili yenileyin veya bir süre bekleyin; özet GET /api/v1/profile/request-summary ile gelir.',
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
