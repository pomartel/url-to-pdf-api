const core = require('./render-core');
const config = require('../config');

let active = 0;
async function render(opts) {
  if (active >= config.MAX_CONCURRENT_RENDERS) {
    const err = new Error('Renderer busy');
    err.status = 503;
    throw err;
  }
  active += 1;
  try {
    return await core.render(opts);
  } finally {
    active -= 1;
  }
}
module.exports = { render };
