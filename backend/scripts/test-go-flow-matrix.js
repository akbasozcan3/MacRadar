const { verifyMessagesCameraMatrix } = require('./verify-messaging-camera-matrix');

const HOST = process.env.GO_HOST || '127.0.0.1';
const PORT = process.env.GO_PORT || process.env.PORT || '8090';

(async () => {
  const result = await verifyMessagesCameraMatrix({
    host: HOST,
    port: PORT,
  });
  console.log(`[smoke] Messaging + camera matrix passed: ${result.details}`);
})().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
