const logger = require('../util/logger')(__filename);

function createErrorLogger() {
  return function errorHandler(err, req, res, next) {
    // Browser errors and request headers can contain report URLs and API tokens.
    const status = err.status || 500;
    logger[status >= 500 ? 'error' : 'warn']('Request failed: HTTP %d', status);
    next(err);
  };
}
module.exports = createErrorLogger;
