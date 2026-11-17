import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveController } from '../public/mvp-live.js';
import { entryView } from '../public/mvp-entry.js';

const greeting = '先多跟我讲讲你的事吧。发生了什么、你为什么在意、现在卡在哪里，都可以慢慢说，不用一次讲完。等我真的听懂了，才有可能从看山们的信箱里，替你带回一张相关的纸 🦊';

test('a new live conversation shows Kanshan’s fixed opening once', async () => {
  let html = '';
  const api = {
    async json(path) {
      assert.equal(path, '/api/auth-me');
      return { success: true, localDevelopment: true, user: { id: 'user-1', display_name: '测试用户', avatar_url: null } };
    }
  };
  const controller = createLiveController({ api, render: state => { html = entryView(state); } });
  controller.initialize();
  await controller.action('start');
  await controller.action('enter-chat');

  assert.match(html, new RegExp(greeting));
  assert.equal(controller.getState().user.chat.filter(message => message.text === greeting).length, 1);
  await controller.action('enter-chat');
  assert.equal(controller.getState().user.chat.filter(message => message.text === greeting).length, 1);
});
