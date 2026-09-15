const puppeteer = require('puppeteer');
const _ = require('lodash');
const config = require('../config');
const logger = require('../util/logger')(__filename);


async function createBrowser(opts) {
  const browserOpts = {
    acceptInsecureCerts: opts.ignoreHttpsErrors,
    timeout: config.RENDER_TIMEOUT_MS,
    sloMo: config.DEBUG_MODE ? 250 : undefined,
  };
  if (config.BROWSER_WS_ENDPOINT) {
    browserOpts.browserWSEndpoint = config.BROWSER_WS_ENDPOINT;
    return puppeteer.connect(browserOpts);
  }
  if (config.BROWSER_EXECUTABLE_PATH) {
    browserOpts.executablePath = config.BROWSER_EXECUTABLE_PATH;
  }
  browserOpts.pipe = true;
  browserOpts.headless = !config.DEBUG_MODE;
  browserOpts.args = config.CHROME_NO_SANDBOX ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
  browserOpts.args.push('--disable-dev-shm-usage');
  if (!opts.enableGPU || process.platform === 'win32') {
    browserOpts.args.push('--disable-gpu');
  }
  return puppeteer.launch(browserOpts);
}


async function closeBrowser(browser) {
  const child = browser.process();
  const forceClose = setTimeout(() => {
    if (child && child.exitCode === null) {
      try {
        // Puppeteer launches a process group on Linux; also stop Chrome's children.
        if (process.platform === 'linux') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (err) {
        if (err.code !== 'ESRCH') child.kill('SIGKILL');
      }
    }
  }, 750);
  try {
    await browser.close();
  } finally {
    clearTimeout(forceClose);
  }
}

async function getFullPageHeight(page) {
  const height = await page.evaluate(() => {
    const { body, documentElement } = document;
    return Math.max(
      body.scrollHeight,
      body.offsetHeight,
      documentElement.clientHeight,
      documentElement.scrollHeight,
      documentElement.offsetHeight
    );
  });
  return height;
}

async function render(_opts = {}) {
  const opts = _.merge({
    cookies: [],
    scrollPage: false,
    emulateScreenMedia: true,
    ignoreHttpsErrors: false,
    html: null,
    viewport: {
      width: 1600,
      height: 1200,
    },
    goto: {
      waitUntil: 'networkidle0',
    },
    output: 'pdf',
    pdf: {
      format: 'A4',
      printBackground: true,
    },
    screenshot: {
      type: 'png',
      fullPage: true,
    },
    failEarly: false,
  }, _opts);

  if ((_.get(_opts, 'pdf.width') && _.get(_opts, 'pdf.height')) || _.get(opts, 'pdf.fullPage')) {
    // pdf.format always overrides width and height, so we must delete it
    // when user explicitly wants to set width and height
    opts.pdf.format = undefined;
  }

  let browser;
  let timer;
  let expired = false;
  const started = Date.now();
  let data;
  try {
    browser = await createBrowser(opts);
    timer = setTimeout(() => {
      expired = true;
      closeBrowser(browser).catch(() => {});
    }, Math.max(1, config.RENDER_TIMEOUT_MS - (Date.now() - started)));
    const page = await browser.newPage();
    const failedResponses = [];
    let mainUrlResponse;
    page.on('error', () => { closeBrowser(browser).catch(() => {}); });
    page.on('requestfailed', request => failedResponses.push(request));
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push(response);
      if (response.url() === opts.url) mainUrlResponse = response;
    });
    logger.debug('Set browser viewport..');
    await page.setViewport(opts.viewport);
    if (opts.emulateScreenMedia) {
      logger.debug('Emulate @media screen..');
      await page.emulateMediaType('screen');
    }

    if (opts.cookies && opts.cookies.length > 0) {
      logger.debug('Setting cookies..');

      const client = await page.target().createCDPSession();

      await client.send('Network.enable');
      await client.send('Network.setCookies', { cookies: opts.cookies });
    }

    if (_.isString(opts.html)) {
      logger.debug('Set HTML ..');
      await page.setContent(opts.html, opts.goto);
    } else {
      logger.debug('Loading render destination');
      await page.goto(opts.url, opts.goto);
    }

    if (_.isNumber(opts.waitFor)) {
      await page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), opts.waitFor);
    } else if (_.isString(opts.waitFor)) {
      await page.waitForSelector(opts.waitFor);
    }

    if (opts.scrollPage) {
      logger.debug('Scroll page ..');
      await scrollPage(page);
    }

    if (failedResponses.length) {
      logger.warn(`Number of failed requests: ${failedResponses.length}`);

      if (opts.failEarly === 'all') {
        const err = new Error(`${failedResponses.length} requests have failed. See server log for more details.`);
        err.status = 412;
        throw err;
      }
    }
    if (opts.failEarly === 'page' && (!mainUrlResponse || mainUrlResponse.status() !== 200)) {
      const msg = 'Render destination did not return HTTP 200';
      const err = new Error(msg);
      err.status = 412;
      throw err;
    }

    logger.debug('Rendering ..');
    if (config.DEBUG_MODE) {
      const msg = `\n\n---------------------------------\n
        Chrome does not support rendering in "headed" mode.
        See this issue: https://github.com/GoogleChrome/puppeteer/issues/576
        \n---------------------------------\n\n
      `;
      throw new Error(msg);
    }

    if (opts.output === 'pdf') {
      if (opts.pdf.fullPage) {
        const height = await getFullPageHeight(page);
        opts.pdf.height = height;
      }
      data = Buffer.from(await page.pdf(opts.pdf));
    } else if (opts.output === 'html') {
      data = await page.evaluate(() => document.documentElement.innerHTML);
    } else {
      // This is done because puppeteer throws an error if fullPage and clip is used at the same
      // time even though clip is just empty object {}
      const screenshotOpts = _.cloneDeep(_.omit(opts.screenshot, ['clip']));
      const clipContainsSomething = _.some(opts.screenshot.clip, val => !_.isUndefined(val));
      if (clipContainsSomething) {
        screenshotOpts.clip = opts.screenshot.clip;
      }
      if (_.isNil(opts.screenshot.selector)) {
        data = Buffer.from(await page.screenshot(screenshotOpts));
      } else {
        const selElement = await page.$(opts.screenshot.selector);
        if (!_.isNull(selElement)) {
          data = Buffer.from(await selElement.screenshot());
        }
      }
    }
  } catch (err) {
    if (expired) {
      const timeoutError = new Error('Render deadline exceeded');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (browser) await closeBrowser(browser);
  }

  return data;
}

async function scrollPage(page) {
  // Scroll to page end to trigger lazy loading elements
  await page.evaluate(() => {
    const scrollInterval = 100;
    const scrollStep = Math.floor(window.innerHeight / 2);
    const bottomThreshold = 400;

    function bottomPos() {
      return window.pageYOffset + window.innerHeight;
    }

    return new Promise((resolve, reject) => {
      function scrollDown() {
        window.scrollBy(0, scrollStep);

        if (document.body.scrollHeight - bottomPos() < bottomThreshold) {
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
          return;
        }

        setTimeout(scrollDown, scrollInterval);
      }

      setTimeout(reject, 30000);
      scrollDown();
    });
  });
}

module.exports = {
  render,
};
