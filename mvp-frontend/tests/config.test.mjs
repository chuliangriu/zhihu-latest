import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeSession } from '../public/mvp-auth.js';

test('MVP uses the existing same-origin session routes without client secrets', async () => {
  const config = JSON.parse(await readFile(new URL('../hackathon.config.json', import.meta.url), 'utf8'));
  assert.equal(config.auth.mode, 'same-origin-session');
  assert.equal(config.auth.currentUserPath, '/api/auth-me');
  assert.equal(config.auth.loginPath, '/api/zhihu-login');
  assert.equal(config.port, 4174);
  assert.doesNotMatch(JSON.stringify(config), /appKey|accessToken|serviceRole|apiKey/);
});

test('auth identity uses real nickname and avatar, with Noah as display-only fallback', () => {
  assert.deepEqual(decodeSession({ success: true, user: {
    id: 'user-1', display_name: '林', avatar_url: 'https://pic.example/avatar.png'
  } }), {
    status: 'authenticated',
    identity: {
      id: 'user-1', name: '林', avatarUrl: 'https://pic.example/avatar.png', avatarKey: null
    }
  });

  assert.deepEqual(decodeSession({ success: true, user: {
    id: 'user-2', display_name: '', avatar_url: null
  } }), {
    status: 'authenticated',
    identity: {
      id: 'user-2', name: 'Noah', avatarUrl: null, avatarKey: 'noah'
    }
  });
});
