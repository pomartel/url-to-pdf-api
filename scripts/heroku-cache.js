const fs = require('fs');
const path = require('path');

const source = '/app/.cache/puppeteer';
const target = path.resolve('.cache/puppeteer');
if (source !== target && fs.existsSync(source)) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}
