/* eslint-env mocha */
const { expect } = require('chai');
const request = require('supertest');
const createApp = require('../src/app');
const config = require('../src/config');
const core = require('../src/core/render-core');

// Local HTML avoids external network timing in resource-control tests.
describe('renderer resource controls and authentication', () => {
  let app;
  let original;
  beforeEach(() => {
    original = Object.assign({}, config);
    config.ALLOW_HTTP = true;
    config.API_TOKENS = ['test-only-token'];
    app = createApp();
  });
  afterEach(() => Object.assign(config, original));

  it('allows only liveness without HTTPS or authentication', async () => {
    config.ALLOW_HTTP = false;
    app = createApp();
    await request(app).get('/up')
      .expect(200, 'OK');
    await request(app).get('/healthz').expect(403);
    await request(app).get('/healthz').set('x-forwarded-proto', 'https').expect(401);
    await request(app).post('/api/render').set('x-forwarded-proto', 'https')
      .send({ html: 'test' })
      .expect(401);
  });

  it('authenticates health and render requests', async () => {
    await request(app).get('/healthz').expect(401);
    await request(app).get('/healthz').set('x-api-key', 'wrong').expect(401);
    await request(app).get('/healthz').set('x-api-key', 'test-only-token').expect(200);
    await request(app).post('/api/render').send({ html: 'test' }).expect(401);
  });

  it('rejects unapproved hosts and HTML input', async () => {
    config.DISABLE_HTML_INPUT = true;
    config.ALLOW_URLS = ['domain:app.do', 'domain:app.ps'];
    await request(app).get('/api/render').set('x-api-key', 'test-only-token')
      .query({ url: 'https://example.com/' })
      .expect(403);
    await request(app).get('/api/render').set('x-api-key', 'test-only-token')
      .query({ url: 'https://app.do.example.com/' })
      .expect(403);
    await request(app).get('/api/render').set('x-api-key', 'test-only-token')
      .query({ url: 'http://127.0.0.1/' })
      .expect(403);
    await request(app).post('/api/render').set('x-api-key', 'test-only-token')
      .send({ html: '<h1>test</h1>' })
      .expect(403);
  });

  it('rejects concurrent work without launching another browser', async () => {
    const originalRender = core.render;
    let finish;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    core.render = () => new Promise((resolve) => { finish = resolve; entered(); });
    try {
      const first = request(app).post('/api/render').set('x-api-key', 'test-only-token')
        .send({ html: '<h1>test</h1>' })
        .then(response => response);
      await started;
      await request(app).post('/api/render').set('x-api-key', 'test-only-token')
        .send({ html: '<h1>test</h1>' })
        .expect(503)
        .expect('Retry-After', '2');
      finish(Buffer.from('%PDF-test'));
      expect((await first).status).to.equal(200);
    } finally {
      core.render = originalRender;
    }
  });

  it('closes a timed-out browser and accepts the next render', async () => {
    config.RENDER_TIMEOUT_MS = 3000;
    await request(app).post('/api/render').set('x-api-key', 'test-only-token')
      .send({ html: '<h1>deadline</h1>', waitFor: 15000 })
      .expect(504);
    config.RENDER_TIMEOUT_MS = 23000;
    await request(app).post('/api/render').set('x-api-key', 'test-only-token')
      .send({ html: '<h1>Recovered</h1>' })
      .expect(200);
  });
});
