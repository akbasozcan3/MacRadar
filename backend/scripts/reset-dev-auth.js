const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const port = String(process.env.GO_PORT || process.env.PORT || '8090');
const token = process.env.DEV_RESET_TOKEN || 'macradar-local-reset';
const nodeStorePath = path.join(
  __dirname,
  '..',
  'node',
  'data',
  'local-store.json',
);

function wipeNodeStore() {
  if (!fs.existsSync(nodeStorePath)) {
    return { wiped: false };
  }

  const raw = fs.readFileSync(nodeStorePath, 'utf8');
  const state = JSON.parse(raw);
  const summary = {
    comments: Array.isArray(state.comments) ? state.comments.length : 0,
    follows: Array.isArray(state.follows) ? state.follows.length : 0,
    postEngagements: Array.isArray(state.postEngagements)
      ? state.postEngagements.length
      : 0,
    posts: Array.isArray(state.posts) ? state.posts.length : 0,
    sessions: Array.isArray(state.sessions) ? state.sessions.length : 0,
    users: Array.isArray(state.users) ? state.users.length : 0,
    wiped: true,
  };

  const nextState = {
    ...state,
    comments: [],
    follows: [],
    postEngagements: [],
    posts: [],
    sessions: [],
    users: [],
  };

  fs.writeFileSync(nodeStorePath, JSON.stringify(nextState, null, 2));
  return summary;
}

function main() {
  const request = http.request(
    {
      headers: {
        Accept: 'application/json',
        'Content-Length': '2',
        'Content-Type': 'application/json',
        'X-MacRadar-Reset-Token': token,
      },
      host: '127.0.0.1',
      method: 'POST',
      path: '/api/v1/dev/auth/reset',
      port: Number(port),
    },
    response => {
      let raw = '';
      response.on('data', chunk => {
        raw += chunk;
      });
      response.on('end', () => {
        let payload = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          console.error(raw || `unexpected response with status ${response.statusCode}`);
          process.exit(1);
        }

        const body = payload?.data ?? payload;
        if ((response.statusCode || 0) >= 400) {
          const message =
            payload?.error?.message ||
            `auth reset failed with status ${response.statusCode}`;
          console.error(message);
          if (response.statusCode === 404) {
            console.error('Go backend eski process olabilir. Backendi yeniden baslatip tekrar deneyin.');
          }
          process.exit(1);
        }

        const nodeStore = wipeNodeStore();
        console.log(
          JSON.stringify(
            {
              go: body,
              nodeStore,
            },
            null,
            2,
          ),
        );
      });
    },
  );

  request.on('error', error => {
    console.error(error.message);
    process.exit(1);
  });

  request.write('{}');
  request.end();
}

main();
