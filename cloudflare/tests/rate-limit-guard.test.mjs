import test from 'node:test';
import assert from 'node:assert/strict';
import {personalIdentityCheck} from '../personal-discord.mjs';
import {PANEL_JS} from '../discord2-ui.mjs';

test('Discord 429 retry_after prevents a second upstream request', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({retry_after: 67.2}, {status: 429});
  });
  const id = '481485837801095178';
  const env = {
    BUSHIN_OWNER_DISCORD_ID: id,
    DISCORD_USER_TOKEN: 'placeholder-not-a-real-discord-token-with-adequate-length',
  };
  const ctx = {me: {id, membership: {member: true}}};
  const first = await personalIdentityCheck(env, ctx);
  assert.equal(first.http_status, 429);
  assert.match(first.reason, /429/);
  const second = await personalIdentityCheck(env, ctx);
  assert.equal(second.http_status, 429);
  assert.match(second.reason, /Nenhuma nova requisição/);
  assert.equal(requests, 1, 'Retry-After must block a second Discord fetch');
});

test('generated Discord 2 UI JavaScript remains parseable and backs off catalog retries', () => {
  assert.doesNotThrow(() => new Function(PANEL_JS));
  assert.match(PANEL_JS, /catalogRetryAt/);
  assert.match(PANEL_JS, /discordPauseUntil/);
});
