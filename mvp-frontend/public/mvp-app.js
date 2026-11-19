import { entryView, KANSHAN_PROFILE_PROMPT, SCENE_SCREENS } from './mvp-entry.js';
import { createLiveController } from './mvp-live.js';
import { consumeLoginReturn } from './mvp-auth.js';

// The default entry uses the real business API. Frozen samples stay in qiaomen.
const app = document.querySelector('#app');
let lastScreen = null;
let wasHomeExampleOpen = false;
const controller = createLiveController({
  render(state) {
    const fieldId = document.activeElement?.id;
    const selection = document.activeElement?.selectionStart;
    document.body.dataset.screen = state.screen;
    app.classList.toggle('chat-scene-active', SCENE_SCREENS.includes(state.screen));
    const html = entryView(state);
    const existingWindow = app.querySelector('.kanshan-window');
    if (lastScreen === 'chat' && state.screen === 'chat' && state.chatOpen && existingWindow) {
      // Do not recreate the textarea on every streamed token: doing so breaks
      // Chinese IME composition and makes it feel as though typing is locked.
      const next = document.createElement('div'); next.innerHTML = html;
      existingWindow.querySelector('.kanshan-body').innerHTML = next.querySelector('.kanshan-body').innerHTML;
      existingWindow.querySelector('.kanshan-composer > p').innerHTML = next.querySelector('.kanshan-composer > p').innerHTML;
      const textarea = existingWindow.querySelector('#kanshan-message');
      if (textarea.value !== state.chatDraft) textarea.value = state.chatDraft;
      existingWindow.querySelector('[data-action="send-chat"]').disabled = !state.chatDraft.trim();
      app.querySelectorAll('.mvp-live-status').forEach(node => node.remove());
      next.querySelectorAll('.mvp-live-status').forEach(node => app.append(node));
    } else app.innerHTML = html;
    app.querySelectorAll('button[data-action]').forEach(button => {
      if (button.dataset.action === 'send-chat') button.disabled = !state.chatDraft.trim();
    });
    if (state.screen === 'chat') app.querySelectorAll('.kanshan-titlebar button, .kanshan-launcher, .scene-tools button').forEach(button => { button.disabled = false; });
    if (state.busy) app.querySelectorAll('button[data-action]:not([data-action="cancel-reply"])').forEach(button => {
      if (button.dataset.action === 'send-chat' && state.phase && !state.queuedChat) button.disabled = !state.chatDraft.trim();
      else button.disabled = true;
    });
    const dialog = app.querySelector('.profile-import-dialog, .home-example-dialog');
    if (dialog) {
      const closeAction = state.homeExampleOpen ? 'close-home-example' : state.paperEdit ? 'cancel-paper-edit' : 'close-profile';
      dialog.showModal();
      dialog.addEventListener('cancel', event => { event.preventDefault(); controller.action(closeAction); });
      if (state.homeExampleOpen) dialog.addEventListener('click', event => {
        const bounds = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) controller.action(closeAction);
      });
    }
    const log = app.querySelector('.zh-private-history, .kanshan-body');
    if (log) log.scrollTop = log.scrollHeight;
    const restored = fieldId ? document.getElementById(fieldId) : null;
    if (restored && !dialog && restored !== document.activeElement) { restored.focus(); if (selection != null) restored.setSelectionRange(selection, selection); }
    if (lastScreen !== state.screen && !dialog) {
      app.querySelector('#discussion-message, #private-message, #public-response, #kanshan-message')?.focus();
    }
    if (wasHomeExampleOpen && !state.homeExampleOpen && state.screen === 'home') {
      document.getElementById(`home-paper-${state.homeExampleTrigger}`)?.focus();
    }
    wasHomeExampleOpen = state.homeExampleOpen;
    lastScreen = state.screen;
  },
});

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  if (button.dataset.action === 'copy-discovery-diagnostic') {
    const diagnostic = controller.getState().discoveryDiagnostic;
    if (!diagnostic) return;
    try { await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2)); button.textContent = '诊断已复制'; }
    catch { button.textContent = '复制失败，请稍后重试'; }
    return;
  }
  if (button.dataset.action === 'copy-profile-diagnostic') {
    const diagnostic = controller.getState().profileDiagnostic;
    if (!diagnostic) return;
    try { await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2)); button.textContent = '诊断已复制'; }
    catch {
      const field = document.getElementById('profile-sync-diagnostic');
      if (field) { field.closest('details').open = true; field.focus(); field.select(); }
      button.textContent = '请复制展开的诊断信息';
    }
    return;
  }
  if (button.dataset.action === 'copy-profile-prompt') {
    try { await navigator.clipboard.writeText(KANSHAN_PROFILE_PROMPT); button.textContent = '已复制'; }
    catch { app.querySelector('details').open = true; button.textContent = '请展开后手动复制'; }
    return;
  }
  controller.action(button.dataset.action, button.dataset.id);
});

const fields = { 'kanshan-message': ['chatDraft', 'send-chat'], 'private-message': ['privateDraft', 'send-private'], 'public-response': ['publicDraft', 'send-public'], 'discussion-message': ['replyDraft', 'send-discussion'] };
app.addEventListener('input', event => {
  const entry = fields[event.target.id];
  if (entry) {
    controller.input(entry[0], event.target.value);
    const button = app.querySelector(`[data-action="${entry[1]}"]`);
    const state = controller.getState();
    const canQueue = entry[1] === 'send-chat' && state.phase && !state.queuedChat;
    if (button) button.disabled = (state.busy && !canQueue) || !event.target.value.trim();
  } else if (event.target.dataset.field) controller.input(event.target.dataset.field, event.target.type === 'checkbox' ? event.target.checked : event.target.value);
});
app.addEventListener('keydown', event => {
  const entry = fields[event.target.id];
  if (entry && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); controller.action(entry[1]);
  }
});
controller.initialize({ loginReturn: consumeLoginReturn() });
