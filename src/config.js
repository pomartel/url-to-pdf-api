/* eslint-disable no-process-env */

// Env vars should be casted to correct types
const config = {
  HOST: process.env.HOST || '0.0.0.0',
  MAX_CONCURRENT_RENDERS: Number(process.env.MAX_CONCURRENT_RENDERS) || 1,
  RENDER_TIMEOUT_MS: Number(process.env.RENDER_TIMEOUT_MS) || 23000,
  CHROME_NO_SANDBOX: process.env.CHROME_NO_SANDBOX === 'true',
  PORT: Number(process.env.PORT) || 9000,
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ALLOW_HTTP: process.env.ALLOW_HTTP === 'true',
  DEBUG_MODE: process.env.DEBUG_MODE === 'true',
  DISABLE_HTML_INPUT: process.env.DISABLE_HTML_INPUT === 'true',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  BROWSER_WS_ENDPOINT: process.env.BROWSER_WS_ENDPOINT,
  BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH,
  API_TOKENS: [],
  ALLOW_URLS: [],
};

if (process.env.API_TOKENS) {
  config.API_TOKENS = process.env.API_TOKENS.split(',');
}

if (process.env.ALLOW_URLS) {
  config.ALLOW_URLS = process.env.ALLOW_URLS.split(',');
}

module.exports = config;
