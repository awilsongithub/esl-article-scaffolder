import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import {
  Anthropic, ARTICLE_TEXT, budget, close, deferred, fake, getDb, jobs, levelStatus, post, repo,
  response, seedArticle, usageRows, validResponse,
} from './helpers.js';

after(close);
beforeEach(() => fake.reset());

const perCall = () => budget.estimateCallUsd(ARTICLE_TEXT);
const close2 = (a, b) => Math.abs(a - b) < 1e-9;

describe('POST /articles/:id/levels/:level/retry', () => {
  test('failed level → 202, one model call, content saved', async () => {
    const id = await seedArticle();
    const res = await post(`/articles/${id}/levels/g5/retry`);
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { articleId: id, level: 'g5', status: 'pending' });
    await jobs.whenIdle();
    assert.equal(fake.calls, 1);
    const row = await repo.getLevelOutput(id, 'g5');
    assert.equal(row.status, 'ready');
    assert.equal(JSON.parse(row.content_json).title, 'Water');
    assert.ok(row.docx_path);
    assert.equal(await levelStatus(id, 'k'), 'failed', 'other levels untouched');
    const [usage] = await usageRows(id);
    assert.ok(Number.isInteger(usage.duration_ms));
    assert.equal(budget.reservedTotal(), 0);
  });

  test('ready level → 200 with saved content, no model call, nothing reserved', async () => {
    const id = await seedArticle({ g5: 'ready' });
    const res = await post(`/articles/${id}/levels/g5/retry`);
    assert.equal(res.status, 200);
    assert.equal(res.body.content.title, 'Saved');
    assert.equal(fake.calls, 0);
    assert.equal(budget.reservedTotal(), 0);
  });

  test('pending / processing level → 409, no model call', async () => {
    for (const status of ['pending', 'processing']) {
      const id = await seedArticle({ g5: status });
      const res = await post(`/articles/${id}/levels/g5/retry`);
      assert.equal(res.status, 409);
      assert.match(res.body.error, /already/);
    }
    assert.equal(fake.calls, 0);
    assert.equal(budget.reservedTotal(), 0);
  });

  test('unknown article or level → 404', async () => {
    assert.equal((await post('/articles/99999/levels/g5/retry')).status, 404);
    const id = await seedArticle();
    assert.equal((await post(`/articles/${id}/levels/nope/retry`)).status, 404);
  });

  test('budget exhausted → 429 and the level stays failed', async () => {
    const id = await seedArticle();
    await repo.addUsage({ day: budget.today(), articleId: null, level: null, model: 'x', inputTokens: 0, outputTokens: 0, costUsd: 1 });
    try {
      const res = await post(`/articles/${id}/levels/g5/retry`);
      assert.equal(res.status, 429);
      assert.equal(await levelStatus(id, 'g5'), 'failed');
      assert.equal(fake.calls, 0);
    } finally {
      await getDb().run('DELETE FROM usage WHERE article_id IS NULL');
    }
  });
});

describe('POST /articles/:id/retry', () => {
  test('claims only the failed levels', async () => {
    const id = await seedArticle({ k: 'failed', g5: 'failed', g10: 'ready' });
    const res = await post(`/articles/${id}/retry`);
    assert.equal(res.status, 202);
    assert.deepEqual([...res.body.claimed].sort(), ['g5', 'k']);
    await jobs.whenIdle();
    assert.equal(fake.calls, 2);
    assert.equal(budget.reservedTotal(), 0);
  });

  test('all ready → 200 with the article; something running → 409', async () => {
    const done = await seedArticle({ k: 'ready', g5: 'ready', g10: 'ready' });
    const res = await post(`/articles/${done}/retry`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ready');

    const busy = await seedArticle({ k: 'processing', g5: 'ready', g10: 'ready' });
    assert.equal((await post(`/articles/${busy}/retry`)).status, 409);
    assert.equal(fake.calls, 0);
  });
});

describe('double-click race', () => {
  test('5 simultaneous retries of one level → one 202, four 409, one model call', async () => {
    const id = await seedArticle();
    const gate = deferred();
    fake.reset(() => gate.promise);

    const results = await Promise.all(Array.from({ length: 5 }, () => post(`/articles/${id}/levels/g5/retry`)));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [202, 409, 409, 409, 409]);

    // Let the winning job reach the model, then check only one call holds budget.
    while (fake.calls === 0) await new Promise((r) => setImmediate(r));
    assert.equal(fake.calls, 1);
    assert.ok(close2(budget.reservedTotal(), perCall()), 'only one call reserved');

    gate.resolve(validResponse());
    await jobs.whenIdle();
    assert.equal(fake.calls, 1);
    assert.equal(await levelStatus(id, 'g5'), 'ready');
    assert.equal(budget.reservedTotal(), 0);
  });

  test('article retry and level retry together never claim a level twice', async () => {
    const id = await seedArticle();
    const gate = deferred();
    fake.reset(() => gate.promise);

    const [all, one] = await Promise.all([post(`/articles/${id}/retry`), post(`/articles/${id}/levels/g5/retry`)]);
    const started = (all.status === 202 ? all.body.claimed.length : 0) + (one.status === 202 ? 1 : 0);
    assert.equal(started, 3, 'each of the 3 levels started exactly once');

    gate.resolve(validResponse());
    await jobs.whenIdle();
    assert.equal(fake.calls, 3);
    assert.equal(budget.reservedTotal(), 0);
  });

  test('retry while the original job is still running → 409', async () => {
    const id = await seedArticle();
    const gate = deferred();
    fake.reset(() => gate.promise);
    assert.equal((await post(`/articles/${id}/levels/k/retry`)).status, 202);
    assert.equal((await post(`/articles/${id}/levels/k/retry`)).status, 409);
    assert.equal((await post(`/articles/${id}/levels/k/regenerate`)).status, 409);
    gate.resolve(validResponse());
    await jobs.whenIdle();
    assert.equal(fake.calls, 1);
  });
});

describe('server retry policy', () => {
  test('invalid JSON then valid → ready after 2 calls, 2 usage rows', async () => {
    const id = await seedArticle();
    let n = 0;
    fake.reset(async () => (++n === 1 ? response('not json{') : validResponse()));
    await post(`/articles/${id}/levels/g5/retry`);
    await jobs.whenIdle();
    assert.equal(fake.calls, 2);
    assert.equal(await levelStatus(id, 'g5'), 'ready');
    assert.equal((await usageRows(id)).length, 2);
  });

  test('timeout twice → failed after 2 calls, nothing saved', async () => {
    const id = await seedArticle();
    fake.reset(async () => { throw new Anthropic.APIConnectionTimeoutError(); });
    await post(`/articles/${id}/levels/g5/retry`);
    await jobs.whenIdle();
    assert.equal(fake.calls, 2);
    const row = await repo.getLevelOutput(id, 'g5');
    assert.equal(row.status, 'failed');
    assert.equal(row.content_json, null);
    assert.match(row.error, /too long/);
    assert.equal(budget.reservedTotal(), 0);
  });

  for (const [name, handler] of [
    ['refusal', async () => response('', 'refusal')],
    ['max_tokens', async () => response('{"title":', 'max_tokens')],
    ['400 bad request', async () => { throw new Anthropic.BadRequestError(400, {}, 'bad', new Headers()); }],
  ]) {
    test(`${name} → failed after 1 call`, async () => {
      const id = await seedArticle();
      fake.reset(handler);
      await post(`/articles/${id}/levels/g5/retry`);
      await jobs.whenIdle();
      assert.equal(fake.calls, 1);
      assert.equal(await levelStatus(id, 'g5'), 'failed');
    });
  }
});
