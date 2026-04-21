if (process.env.START_METRO == null) {
  process.env.START_METRO = '1';
}

require('./start-app-stack');
