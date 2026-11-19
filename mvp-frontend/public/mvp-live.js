import { createEntryController } from './mvp-entry.js';
import { createApi, discoveryView, safeZhihuUrl, profileDiagnostic } from './mvp-api.js';
import { decodeSession } from './mvp-auth.js';
import { initialUser } from './mvp-profile.js';

const NEW_CONVERSATION_GREETING = '先多跟我讲讲你的事吧。发生了什么、你为什么在意、现在卡在哪里，都可以慢慢说，不用一次讲完。等我真的听懂了，才有可能从看山们的信箱里，替你带回一张相关的纸 🦊';

export function createLiveController({ render, api = createApi(), navigate = url => globalThis.location.assign(url), schedule = setTimeout, cancel = clearTimeout }) {
  const base = createEntryController({ render, schedule, cancel });
  const state = base.getState();
  Object.assign(state, { live: true, busy: false, phase: null, queuedChat: '', error: '', conversationId: null, discoveryId: null, sessionReady: false, authRequired: false, accountNotice: '', profileSource: '', profileDiagnostic: null, profileNotice: '', profileIssueCode: '', profileNeedsLogin: false, profileRetryAt: 0, profileQuotaBlocked: false, paper: null, activePapers: [], mailbox: null, discussion: null, replyDraft: '', replyPending: null, standalonePaper: false, paperOptions: {matchingAllowed:true,identityDisclosure:'nickname',contactAllowed:true} });
  state.profileSource = '';
  state.chatNotice = '';
  const paint = () => render(state);
  const candidate = () => state.user.candidates[state.selected];
  const canRespond = () => candidate() && (candidate().contact || candidate().synthetic);
  let controller;
  function fail(error) {
    const code = error?.code || error?.message || 'SERVICE_UNAVAILABLE';
    if (/^(NOT_LOGGED_IN|UNAUTHENTICATED)$/.test(code)) { clearAccount(); state.screen = 'login'; state.authRequired = true; state.error = '登录状态已失效，请重新登录。'; return; }
    const modelFailures = {
      LLM_OUTPUT_INVALID: '看山这次没把纸条整理好。你的聊天和选择都还在，可以点“重新整理纸条”再试；还没有投入信箱。',
      LLM_TIMEOUT: '整理纸条暂时超时了。你的聊天和选择都还在，可以点“重新整理纸条”再试；还没有投入信箱。',
      LLM_UPSTREAM_BUSY: '模型服务暂时繁忙，请稍后点“重新整理纸条”。还没有投入信箱。',
      LLM_UNAVAILABLE: '模型服务暂时没有连通，请稍后点“重新整理纸条”。还没有投入信箱。',
      PAPER_FACTS_UNGROUNDED: '这次整理带入了你没有说过的细节，纸条没有保存。请点“重新整理纸条”再试。'
    };
    if (state.screen === 'consent' && modelFailures[code]) { state.error = modelFailures[code]; return; }
    const protectionFailures = {
      OWN_PAPER_REQUIRED: '请先确认并留下自己的纸条，再开始交流；纸条需要允许交流。',
      DISCUSSION_CLOSED: '纸条已撤回、到期或不接受新的交流。已有讨论可从“我的纸条与交流”查看。',
      MAILBOX_PERSISTENCE_REQUIRED: '纸条与交流的持久存储尚未启用，请稍后再试。',
      MAILBOX_SETUP_REQUIRED: '纸条与交流的存储尚未配置完成，请稍后再试。',
      STORE_NOT_FOUND: '这张纸条或交流暂时不可访问。',
      STORE_CONFLICT: '纸条状态已变化，请刷新后再试。',
      SHORT_RATE_LIMITED: '操作太快了，请在稍后再试。',
      CONCURRENCY_LIMITED: '上一项任务仍在处理，请等待完成后再试。',
      DAILY_QUOTA_EXCEEDED: '今日体验额度已用完，请明天再试。',
      GLOBAL_BUDGET_EXCEEDED: '今日服务资源已用完，暂时不能继续生成。',
      LLM_DISABLED: '真实模型调用暂时关闭。',
      BUDGET_SERVICE_UNAVAILABLE: '安全计量服务暂时不可用；本次请求没有提交给模型，请稍后重试。',
      SERVICE_BUDGET_UNAVAILABLE: '安全计量服务暂时不可用；本次请求没有提交给模型，请稍后重试。',
      MONITORING_SERVICE_UNAVAILABLE: '安全计量服务暂时不可用；本次请求没有提交给模型，请稍后重试。',
      LLM_UPSTREAM_BUSY: '模型供应商暂时繁忙，请稍后重试。',
      LLM_TIMEOUT: '模型回复超时，请稍后重试。',
      LLM_TIMEOUT_OR_ABORTED: '模型请求被中断或超时，请稍后重试。',
      REQUEST_CANCELLED: '本次回复已停止，可以继续聊天。',
      IDEMPOTENCY_REPLAY: '相同请求已在处理或刚提交，请不要重复发送。'
    };
    if (protectionFailures[code]) { state.error = protectionFailures[code]; return; }
    state.error = error?.name === 'AbortError' ? '已停止本次回答，可以继续聊。' :
      /NOT_LOGGED|UNAUTHENTICATED/.test(code) ? '登录状态已失效，请回到首页重新进入。' :
      /INJECTION|REJECTED/.test(code) ? '这段内容暂时无法处理，请调整后再试。' :
      `这次没有完成，请重试。${code ? `（${code}）` : ''}`;
  }
  let profileRetryTimer;
  function profileFailure(code, coverage, sources, retryAfter) {
    const seconds = Number(retryAfter);
    const date = typeof retryAfter === 'string' ? Date.parse(retryAfter) : NaN;
    const until = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : date;
    state.profileRetryAt = Number.isFinite(until) && until > Date.now() ? until : 0;
    clearTimeout(profileRetryTimer);
    if (state.profileRetryAt) {
      profileRetryTimer = setTimeout(paint, Math.min(2147483647, state.profileRetryAt - Date.now() + 50));
      profileRetryTimer.unref?.();
    }
    state.profileQuotaBlocked = code === 'ZHIHU_QUOTA_EXCEEDED';
    state.profileIssueCode = code;
    state.profileNeedsLogin = /^(OAUTH_REAUTH_REQUIRED|OAUTH_TOKEN_UNAVAILABLE|NOT_LOGGED_IN|UNAUTHENTICATED)$/.test(code);
    const messages = {
      PROFILE_NOT_CONNECTED: '背景同步服务暂未启用。你可以先补充背景，或直接开始聊天。',
      OAUTH_REAUTH_REQUIRED: '知乎授权已失效，请重新登录后同步背景。',
      OAUTH_TOKEN_UNAVAILABLE: '暂时无法读取知乎授权，请重新登录后再试。',
      NOT_LOGGED_IN: '登录状态已失效，请重新登录后同步背景。',
      UNAUTHENTICATED: '登录状态已失效，请重新登录后同步背景。',
      ZHIHU_RATE_LIMITED: '知乎读取触发频率限制，请等待后再同步背景。',
      ZHIHU_QUOTA_EXCEEDED: '知乎接口可用额度已耗尽，恢复时间以知乎为准。可以先手动补充背景。',
      ZHIHU_ACCESS_SECRET_REJECTED: '知乎连接配置暂不可用，请稍后再试。你可以先手动补充背景。',
      insufficient_footprints: '暂未读到可用的知乎创作或收藏。可以先手动补充背景。',
      profile_insufficient_evidence: '这次暂未生成背景。可以重新同步，或先手动补充背景。',
      profile_output_incomplete: '知乎资料已读取，但这次背景整理不完整。请重新同步，或先手动补充背景。',
      profile_evidence_rejected: '知乎足迹已读取，但这次生成的背景内容或引用未通过核验。可以重新同步，或先手动补充背景。',
      SHORT_RATE_LIMITED: '同步太频繁了，请稍后再试。',
      DAILY_QUOTA_EXCEEDED: '今天的背景同步额度已用完，可以先手动补充背景。',
    };
    if (['LLM_TIMEOUT', 'LLM_TIMEOUT_OR_ABORTED', 'LLM_ABORTED'].includes(code)) {
      messages[code] = '知乎足迹已读取，但生成背景超时了。可以重新同步，或先手动补充背景。';
    } else if (['LLM_HTTP_401', 'LLM_HTTP_403', 'LLM_CONFIG_MISSING'].includes(code)) {
      messages[code] = '已读取你的知乎足迹，但背景生成服务的配置暂不可用。可以先手动补充背景。';
    } else if (code === 'LLM_HTTP_429') {
      messages[code] = '知乎足迹已读取，但背景生成服务暂时受限。请稍后重新同步，或先手动补充背景。';
    } else if (['LLM_SCHEMA_INVALID', 'LLM_OUTPUT_NOT_JSON', 'LLM_RESPONSE_NOT_JSON', 'LLM_EMPTY_RESPONSE', 'LLM_OUTPUT_LIMIT_REACHED'].includes(code)) {
      messages[code] = '知乎足迹已读取，但这次没有生成完整可用的背景介绍。可以重新同步，或先手动补充背景。';
    } else if (/^LLM_HTTP_5[0-9][0-9]$/.test(code) || ['LLM_NETWORK_ERROR', 'LLM_REQUEST_FAILED'].includes(code)) {
      messages[code] = '知乎足迹已读取，但背景生成服务暂时没有连通。请稍后重新同步，或先手动补充背景。';
    }
    const read = (coverage?.creations || 0) + (coverage?.collections || 0) > 0;
    state.profileNotice = messages[code] || (read
      ? '已读取你的知乎足迹，但暂时无法整理背景。可以稍后重新同步，或先手动补充。'
      : '这次没能同步背景。可以重新同步，或先手动补充背景。');
    if (sources?.creation === 'read' && sources?.collection === 'failed') {
      state.profileNotice = `已读取创作中的 ${coverage?.creations || 0} 条可用资料，收藏暂未读取。${state.profileNotice}`;
    }
    if (state.profileRetryAt) state.profileNotice += ` 最早可于 ${new Date(state.profileRetryAt).toLocaleTimeString('zh-CN', { hour12: false })} 再试。`;
  }
  async function syncProfile() {
    state.profileSource = ''; state.profileNotice = ''; state.profileDiagnostic = null; state.profileIssueCode = ''; state.profileNeedsLogin = false; state.profileRetryAt = 0; state.profileQuotaBlocked = false;
    state.phase = 'profile_summary'; paint();
    try {
      const profile = await api.json('/api/profile/summary', { useAuthorizedFootprints: true });
      if (profile.status === 'ready' && profile.profile) {
        state.profileSource = profile.reasonCode === 'profile_summary_from_footprints' ? 'footprints' : 'model';
        Object.assign(state.user, { role: profile.profile.role, impression: profile.profile.impression,
          recentFocus: profile.profile.recentFocus, profileReady: true });
      } else {
        state.profileDiagnostic = profileDiagnostic(profile);
        profileFailure(profile.reasonCode || 'PROFILE_UNAVAILABLE', profile.coverage, profile.sources, profile.retryAfterSeconds);
      }
    } catch (error) {
      const code = error?.code || error?.message || 'PROFILE_UNAVAILABLE';
      state.profileDiagnostic = profileDiagnostic({ reasonCode: code, requestId: error?.requestId, coverage: error?.coverage, diagnostics: error?.diagnostics });
      profileFailure(code, error?.coverage, error?.sources, error?.retryAfter);
    } finally { state.phase = null; }
  }
  async function retryProfile() {
    if (state.busy || !state.sessionReady || state.localDevelopment || state.user.profileReady || state.profileRetryAt > Date.now()) return;
    state.busy = true; paint();
    try { await syncProfile(); } finally { state.busy = false; paint(); }
  }
  function clearAccount() {
    base.stop(); clearTimeout(profileRetryTimer);
    Object.assign(state, { user: initialUser(), sampleScenario: null, conversationId: null, discoveryId: null,
      sessionReady: false, localDevelopment: false, selected: null, paper: null, paperEdit: null, activePapers: [], mailbox: null, discussion: null, replyDraft: '', replyPending: null, standalonePaper: false, paperOptions: {matchingAllowed:true,identityDisclosure:'nickname',contactAllowed:true},
      chatDraft: '', queuedChat: '', privateDraft: '', privateMessages: [], publicDraft: '', publicReplies: [],
      profileDraft: '', nameDraft: '', roleDraft: '', profileOpen: false, profileError: '',
      accountNotice: '', profileSource: '', profileDiagnostic: null, profileNotice: '', profileIssueCode: '', profileNeedsLogin: false, profileRetryAt: 0, profileQuotaBlocked: false,
      stage: 0, typewriterStage: null, typedChars: 0, chatNotice: '' });
  }
  async function logout() {
    state.busy = true; state.error = ''; paint();
    try {
      await api.json('/api/logout', {});
      clearAccount(); state.authRequired = false; state.screen = 'home';
    } catch { state.error = '退出未完成，请稍后重试。'; }
    finally { state.busy = false; paint(); }
  }
  async function start({ redirectGuest = true } = {}) {
    state.screen = 'login'; state.busy = true; state.phase = 'session'; state.error = ''; paint();
    try {
      const session = await api.json('/api/auth-me', undefined, 'GET');
      const decoded = decodeSession(session);
      if (decoded.status !== 'authenticated') throw new Error('SESSION_INVALID');
      if (state.user.id !== decoded.identity.id) clearAccount();
      Object.assign(state.user, decoded.identity); state.sessionReady = true; state.authRequired = false;
      state.localDevelopment = session.localDevelopment === true;
      if (session.accountNotice === 'history_unlinked') state.accountNotice = '已登录。旧账号的历史暂未关联，原记录仍保留。';
      state.chatNotice = '';
      if (!state.localDevelopment && !state.user.profileReady) {
        await syncProfile();
      }
    } catch (error) {
      if (/^(NOT_LOGGED_IN|UNAUTHENTICATED)$/.test(error?.code || error?.message || '')) {
        clearAccount();
        state.authRequired = true;
        state.error = '';
        // Start OAuth in this window after an explicit entry click; Safari need not allow pop-ups.
        // A callback marker is only a hint: if its session is missing, show the link instead of looping.
        if (redirectGuest) {
          try { navigate('/api/zhihu-login'); }
          catch { state.error = '未能打开知乎登录，请点击下方按钮重试。'; }
        } else state.error = '暂未确认登录成功，请点击下方按钮重新登录知乎。';
      } else fail(error);
    }
    finally { state.busy = false; state.phase = null; paint(); }
  }
  async function send() {
    const text = state.chatDraft.trim(); if (!text || state.busy || !state.sessionReady) return;
    base.stop(); state.error = ''; state.busy = true; state.phase = 'reply'; state.selected = null; state.paper = null;
    state.user.chat = [...state.user.chat, ...state.user.discoveryChat, { role: 'user', text }]; state.user.discoveryChat = [];
    state.privateDraft = ''; state.publicDraft = ''; state.privateMessages = []; state.publicReplies = [];
    const answer = { role: 'agent', text: '' }; state.user.chat.push(answer);
    state.stage = state.user.chat.length; state.chatDraft = ''; state.typewriterStage = null;
    state.chatNotice = '看山正在回应，你也可以继续输入。';
    controller = new AbortController(); paint();
    try {
      const done = await api.chat(state.conversationId, text, chunk => { answer.text += chunk; paint(); }, controller.signal, completed => {
        state.conversationId = completed.conversationId;
        state.chatNotice = '你可以接着说，我在看看有没有相关的表达。'; paint();
      });
      state.conversationId = done.conversationId;
      if (done.discovery?.eligible && !state.queuedChat) {
        state.phase = 'discovery';
        state.chatNotice = '我再找找有没有相关的表达。你可以接着说，不用等我。'; paint();
        try {
          const result = await api.json(`/api/conversations/${done.conversationId}/discovery`, {
            assistantMessageId: done.assistantMessageId, topicKey: done.discovery.topicKey
          }, 'POST', controller.signal);
          state.discoveryId = result.discoveryId;
          const display = discoveryView(result, state.user.name);
          state.user.candidates = display.candidates; state.user.discoveryChat = display.messages;
          if (!display.messages.length) state.chatNotice = result.status === 'unavailable'
            ? /zhihu_quota_exceeded/i.test(result.reasonCode) ? '知乎搜索额度暂不可用，这次匹配没有完成。刚才的聊天已保留。'
              : /zhihu_rate_limited/i.test(result.reasonCode) ? '知乎搜索触发频率限制，这次匹配没有完成。请稍后再试，刚才的聊天已保留。'
              : '这次匹配暂时没有完成，刚才的聊天已保留。可以稍后再试。'
            : result.status === 'not_eligible' ? '我们先接着聊聊刚才的事。' : '这次暂时没有找到有具体关联的表达。我们可以接着聊。';
          else state.chatNotice = '';
        } catch {
          // Discovery is an optional follow-up. The streamed chat answer has
          // already completed and must remain usable if a JSON-only matching
          // stage rejects a provider response.
          state.chatNotice = '这次没能整理出相关的纸条，但刚才的聊天已经完成。你可以继续说。';
        }
      } else state.chatNotice = '';
    } catch (error) { fail(error); }
    finally {
      state.busy = false; state.phase = null; controller = null;
      if (state.queuedChat) {
        // Serialize requests to respect the backend's per-user concurrency
        // limit. Do not drop a submitted message or duplicate a cost request.
        const next = state.queuedChat; state.queuedChat = '';
        const composing = state.chatDraft; state.chatDraft = next;
        const pending = send(); state.chatDraft = composing; paint();
        await pending;
      } else base.resume();
    }
  }
  async function draft() {
    state.busy = true; state.error = ''; paint();
    try {
      const paper = await api.json('/api/papers/drafts', { conversationId: state.conversationId,
        confirmedProfile: state.user.profileReady ? { background: [...state.user.impression], recentFocus: state.user.recentFocus || null } : null });
      state.paper = paper; state.user.sharePaper = paper; state.paperOrigin = '由看山根据刚才的对话整理'; state.screen = 'share';
    } catch (error) { fail(error); }
    finally { state.busy = false; paint(); }
  }
  async function deposit() {
    if (!state.paper) return;
    const target = candidate(); state.busy = true; state.error = ''; paint();
    try {
      const result = await api.json(`/api/papers/${state.paper.id}/confirm`, { expectedVersion: state.paper.version,
        discoverableDays: 7, ...state.paperOptions,
        target: target?.sourceType === 'authorized_private' && state.paperOptions.contactAllowed ? { kind: 'selected_private', discoveryId: state.discoveryId, candidateId: target.candidateId } : target?.sourceType === 'synthetic_private' ? { kind: 'synthetic_demo', discoveryId: state.discoveryId, candidateId: target.candidateId } : { kind: 'mailbox_only' } });
      state.paper = result.paper; state.user.sharePaper = result.paper; state.delivery = result.delivery;
      if (!result.delivery && target?.sourceType === 'authorized_private' && !/^[0-9a-f-]{36}$/i.test(target.candidateId)) {
        target.sourceType = 'synthetic_private'; target.synthetic = true;
      }
      state.activePapers = [...state.activePapers.filter(p => p.id !== result.paper.id), result.paper];
      state.screen = 'deposit'; paint();
      state.timer = schedule(() => { state.timer = null; state.screen = 'delivered'; state.busy = false; paint(); }, 1200);
    } catch (error) { state.busy = false; fail(error); paint(); }
  }
  async function loadMailbox() {
    base.stop(); state.busy = true; state.error = ''; state.screen = 'mailbox'; paint();
    try { state.mailbox = await api.json('/api/mailbox', undefined, 'GET'); state.activePapers = state.mailbox.papers.filter(p => p.status === 'active'); }
    catch (error) { fail(error); }
    finally { state.busy = false; paint(); }
  }
  async function loadDiscussion(id) {
    base.stop(); state.busy = true; state.error = ''; paint();
    try { const next = await api.json(`/api/discussions/${id}`, undefined, 'GET');
      if (state.discussion?.id !== next.id) { state.replyDraft = ''; state.replyPending = null; }
      state.discussion = next; state.screen = 'discussion';
    } catch(error) { fail(error); }
    finally { state.busy = false; paint(); }
  }
  async function openDiscussion() {
    if (candidate()?.synthetic) { base.action('continue-private'); return; }
    if (!candidate() || candidate().sourceType !== 'authorized_private') return;
    state.busy = true; state.error = ''; paint();
    try { state.discussion = await api.json('/api/discussions', {discoveryId:state.discoveryId,candidateId:candidate().candidateId});
      state.replyDraft = ''; state.replyPending = null; state.screen = 'discussion';
    } catch(error) { fail(error); }
    finally { state.busy = false; paint(); }
  }
  async function sendDiscussion() {
    const text = state.replyDraft.trim(), thread = state.discussion;
    if (!text || !thread?.canReply) return;
    if (!state.replyPending || state.replyPending.threadId !== thread.id || state.replyPending.content !== text) state.replyPending = {threadId:thread.id,content:text,clientMessageId:crypto.randomUUID()};
    state.busy = true; state.error = ''; paint();
    try { const pending = state.replyPending;
      state.discussion = await api.json(`/api/discussions/${thread.id}/replies`, {content:pending.content,clientMessageId:pending.clientMessageId});
      state.replyDraft = ''; state.replyPending = null;
    } catch(error) { fail(error); if (error?.code === 'DISCUSSION_CLOSED') { thread.canReply = false; thread.closedReason = 'paper_withdrawn'; } }
    finally { state.busy = false; paint(); }
  }
  async function readCandidate(id) {
    const target = state.user.candidates[id]; if (!target) return;
    if (target.sourceType !== 'authorized_private' || target.synthetic) { base.action('view', id); return; }
    state.busy = true; state.error = ''; paint();
    try { const result = await api.json(`/api/discoveries/${state.discoveryId}/candidates/${encodeURIComponent(target.candidateId)}`, undefined, 'GET');
      if (result.status !== 'active') {
        target.quote = ''; target.profile = []; target.focus = ''; target.shared = ''; target.contact = false;
        if (result.discussionId) { state.discussion = await api.json(`/api/discussions/${result.discussionId}`, undefined, 'GET'); state.replyDraft = ''; state.replyPending = null; state.screen = 'discussion'; }
        else { state.selected = null; state.chatNotice = result.status === 'withdrawn' ? '这张纸条已撤回，不能继续查看。' : '这张纸条已停止新匹配，不能开始新的交流。'; }
      } else { if (result.paper) Object.assign(target,{quote:result.paper.quote,profile:[result.paper.background],name:result.paper.displayName}); target.contact = result.contactable; state.selected = null; base.action('view', id); }
    } catch(error) { fail(error); }
    finally { state.busy = false; paint(); }
  }
  async function handoff() {
    if (!(state.privateDraft.trim() || state.publicDraft.trim()) && candidate()?.sourceType !== 'public') return;
    if (candidate()?.synthetic) {
      state.privateMessages.push(state.privateDraft.trim()); state.privateDraft = ''; paint(); return;
    }
    state.busy = true; state.error = ''; paint();
    try {
      const result = await api.json('/api/handoffs', { discoveryId: state.discoveryId, candidateId: candidate().candidateId });
      const url = safeZhihuUrl(result.redirectUrl); if (!url || result.textTransferred !== false) throw new Error('HANDOFF_INVALID');
      navigate(url);
    } catch (error) { fail(error); }
    finally { state.busy = false; paint(); }
  }
  return { initialize({ loginReturn = false } = {}) {
    base.initialize();
    if (loginReturn) return start({ redirectGuest: false });
  }, input(field, value) {
    if (['matchingAllowed','identityDisclosure','contactAllowed'].includes(field)) { state.paperOptions[field] = value; paint(); }
    else if (field === 'replyDraft') state.replyDraft = value;
    else if (field.startsWith('paper-') && state.paperEdit) state.paperEdit[field.slice(6)] = value;
    else base.input(field, value);
  }, getState: base.getState,
    async action(action, id) {
      if (action === 'cancel-reply') { controller?.abort(); return; }
      if (action === 'send-chat' && state.busy && state.phase && !state.queuedChat && state.chatDraft.trim()) {
        state.queuedChat = state.chatDraft.trim(); state.chatDraft = ''; paint(); return;
      }
      if (state.busy) return;
      if (action === 'save-profile' && !state.nameDraft.trim()) state.nameDraft = state.user.name;
      if (action === 'start') return start();
      if (action === 'logout') return logout();
      if (action === 'retry-profile') return retryProfile();
      if (action === 'enter-chat') {
        if (!state.sessionReady) return start();
        state.sampleScenario = null;
        if (state.conversationId === null && state.user.chat.length === 0 && state.user.discoveryChat.length === 0) {
          state.user.chat.push({ role: 'agent', text: NEW_CONVERSATION_GREETING });
        }
        state.screen = 'chat'; state.chatOpen = true; state.stage = state.user.chat.length + state.user.discoveryChat.length; paint(); return;
      }
      if (action === 'open-mailbox' || action === 'refresh-mailbox') return loadMailbox();
      if (action === 'close-mailbox' || action === 'close-discussion') { state.screen = 'chat'; state.error = ''; paint(); return; }
      if (action === 'open-discussion') return loadDiscussion(id);
      if (action === 'refresh-discussion' && state.discussion) return loadDiscussion(state.discussion.id);
      if (action === 'send-discussion') return sendDiscussion();
      if (action === 'continue-private') return openDiscussion();
      if (action === 'continue-public') return handoff();
      if (action === 'view') return readCandidate(id);
      if (action === 'open-paper') {
        state.busy = true; state.error = ''; paint();
        try { state.paper = await api.json(`/api/papers/${id}`, undefined, 'GET'); state.screen = 'own-paper'; }
        catch(error) { fail(error); } finally { state.busy = false; paint(); } return;
      }
      if (action === 'resume-paper' && state.paper?.status === 'draft') {
        state.standalonePaper = true; state.selected = null; state.user.sharePaper = state.paper; state.screen = 'share'; paint(); return;
      }
      if (action === 'restore-conversation') {
        state.busy = true; state.error = ''; paint();
        try { const saved = await api.json(`/api/conversations/${id}`, undefined, 'GET');
          state.conversationId = saved.conversation.id; state.discoveryId = null; state.selected = null; state.paper = null;
          state.user.chat = saved.messages.filter(m => m.generationStatus === 'complete').map(m => ({role:m.role === 'assistant' ? 'agent' : 'user',text:m.content}));
          state.user.discoveryChat = []; state.user.candidates = {}; state.stage = state.user.chat.length; state.typewriterStage = null;
          state.screen = 'chat'; state.chatNotice = '已恢复这段对话，显示最近 100 条消息。';
        } catch(error) { fail(error); } finally { state.busy = false; paint(); } return;
      }
      if (action === 'leave-paper') {
        if (!state.conversationId) { state.chatNotice = '先和看山聊聊想留下的那件事，再整理成纸条。'; paint(); return; }
        state.selected = null; state.paper = null; state.standalonePaper = true; state.paperOptions = {matchingAllowed:true,identityDisclosure:'nickname',contactAllowed:true}; state.screen = 'consent'; state.error = ''; paint(); return;
      }
      if (action === 'send-chat') return send();
      if (action === 'confirm-consent') {
        if (state.screen === 'consent' && (state.standalonePaper || canRespond())) return draft();
        return;
      }
      if (action === 'deposit') {
        if (state.screen === 'share' && (state.standalonePaper || canRespond())) return deposit();
        return;
      }
      if (action === 'edit-paper') { state.paperEdit = { subject: state.paper.subject, quote: state.paper.quote, context: state.paper.context, background: state.paper.background }; paint(); return; }
      if (action === 'cancel-paper-edit') { state.paperEdit = null; paint(); return; }
      if (action === 'save-paper-edit') {
        state.busy = true; state.error = ''; paint();
        try { state.paper = await api.json(`/api/papers/${state.paper.id}`, { expectedVersion: state.paper.version, ...state.paperEdit }, 'PATCH'); state.user.sharePaper = state.paper; state.paperEdit = null; }
        catch (error) { fail(error); }
        finally { state.busy = false; paint(); }
        return;
      }
      if (action === 'send-private' || action === 'send-public') return handoff();
      if (action === 'withdraw-paper' && (id || state.paper?.id)) {
        state.busy = true; state.error = ''; paint();
        try { const paper = await api.json(`/api/papers/${id || state.paper.id}/withdraw`, {}); state.activePapers = state.activePapers.filter(p => p.id !== paper.id); if (state.paper?.id === paper.id) state.paper = paper; if (state.mailbox) { state.mailbox.papers = state.mailbox.papers.map(p => p.id === paper.id ? paper : p); state.mailbox.discussions = []; } state.discussion = null; state.screen = 'chat'; state.chatNotice = '你的纸条已收回，相关讨论停止新回复。'; } catch (error) { fail(error); }
        finally { state.busy = false; paint(); } return;
      }
      if (action === 'write' && canRespond()) { state.standalonePaper = false; state.paperOptions = {matchingAllowed:true,identityDisclosure:'nickname',contactAllowed:true}; state.user.sharePaper.subject ||= '刚才聊到的事'; state.screen = 'consent'; paint(); return; }
      if (action === 'back' && state.standalonePaper && ['share','consent'].includes(state.screen)) { state.screen = state.screen === 'share' ? 'consent' : 'chat'; state.error = ''; paint(); return; }
      if (action === 'back' && state.screen === 'card' && candidate()?.synthetic) { state.selected = null; state.screen = 'chat'; paint(); return; }
      if (action === 'switch-sample' || action === 'skip-sample' || action === 'replay-chat') return;
      base.action(action, id);
      if (action === 'save-profile' && state.user.profileReady) {
        state.profileSource = '';
        state.profileNotice = ''; state.profileDiagnostic = null; state.profileIssueCode = ''; state.profileNeedsLogin = false; state.profileRetryAt = 0; state.profileQuotaBlocked = false; paint();
      }
    }
  };
}
