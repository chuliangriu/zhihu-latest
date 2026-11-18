export function createApi(fetcher = globalThis.fetch) {
  const error = (payload, response) => new ApiError({
    status: response?.status ?? 0,
    code: payload?.error?.code || (typeof payload?.error === 'string' ? payload.error : null) || payload?.data?.reasonCode || 'SERVICE_UNAVAILABLE',
    coverage: payload?.data?.coverage,
    sources: payload?.data?.sources,
    retryAfter: response?.headers?.get?.('retry-after') ?? payload?.data?.retryAfterSeconds ?? null,
    requestId: payload?.error?.requestId || response?.headers?.get?.('x-request-id') || null,
  });
  async function json(path, body, method = 'POST', signal) {
    const response = await fetcher(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(100000)]) : AbortSignal.timeout(100000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) throw error(payload, response);
    return payload.data ?? payload;
  }
  async function chat(conversationId, message, onDelta, signal, onAnswerComplete = () => {}) {
    const response = await fetcher('/api/chat/reply', { method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ conversationId, message }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(100000)]) : AbortSignal.timeout(100000) });
    if (!response.ok) throw error(await response.json().catch(() => null), response);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('STREAM_INVALID');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', done;
    try {
      while (true) {
        const next = await reader.read();
        buffer += decoder.decode(next.value, { stream: !next.done });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const name = block.match(/^event: (.+)$/m)?.[1];
          const raw = block.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).join('\n');
          if (!raw) continue;
          const value = JSON.parse(raw);
          if (name === 'delta') onDelta(value.text);
          if (name === 'answer_done') onAnswerComplete(value);
          if (name === 'done') done = value;
          if (name === 'error') throw new ApiError({ status: response.status, code: value.code || 'STREAM_FAILED', requestId: value.requestId || response.headers.get('x-request-id') || null });
        }
        if (next.done) break;
      }
      if (!done) throw new Error('STREAM_INTERRUPTED');
      return done;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  return { json, chat };
}

export class ApiError extends Error {
  constructor({ status = 0, code = 'SERVICE_UNAVAILABLE', retryAfter = null, requestId = null, coverage, sources } = {}) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
    if (sources) this.sources = Object.fromEntries(['creation', 'collection'].map(kind => [kind,
      ['read', 'failed', 'not_requested'].includes(sources[kind]) ? sources[kind] : 'not_requested']));
    if (coverage) this.coverage = {
      creations: Number.isInteger(coverage.creations) && coverage.creations >= 0 ? coverage.creations : 0,
      collections: Number.isInteger(coverage.collections) && coverage.collections >= 0 ? coverage.collections : 0,
    };
  }
}

export function safeZhihuUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com'].includes(u.hostname) && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}

export function discoveryView(result, name) {
  const candidates = {}, messages = [];
  const matches = ['situationClose', 'structureRelated'].map(path => result.matches?.[path] ? {...result.matches[path], path} : null).filter(Boolean);
  if (!matches.length) return { candidates, messages };
  const address = name && !['你', 'Noah'].includes(name) ? `${name}，` : '';
  messages.push({ role: 'agent', discovery: 'start', delay: 180, typewriter: true, blocks: [
    { type: 'text', text: `${address}还有一件事儿。刚才听你说这些，我也去找了找有没有相关的表达。` },
    { type: 'lead', text: `有 ${matches.length} 段话，让我想起了你刚才说的事。` }
  ] });
  matches.forEach((match, index) => {
    const synthetic = match.sourceType === 'synthetic_private';
    const copy = result.presentationCopy?.choices?.find(x => x.candidateId === match.candidateId);
    const timeMs = Date.parse(match.publishedAt), days = Math.max(0, Math.floor((Date.now() - timeMs) / 86400000));
    const relativeTime = Number.isFinite(timeMs) ? (days === 0 ? '今天' : `${days} 天前`) : '';
    const time = match.sourceType === 'public' && match.timestampKind === 'sample_created'
      ? `${relativeTime} · 演示时间（非原文发布时间）` : relativeTime;
    const quote = match.evidenceRefs?.find(x => x.side === 'candidate')?.quote || '';
    const key = index === 0 ? 'A' : 'B';
    const sourceUrl = safeZhihuUrl(match.sourceUrl);
    candidates[key] = { candidateId: match.candidateId, path: match.path, sourceType: match.sourceType,
      name: match.authorDisplayName.replace(/ · 非真人$/, ''), avatarKey: null,
      context: match.sourceType === 'public' ? '来自知乎公开表达' : '来自看山们的信箱',
      time, quote, profile: Array.isArray(match.profileBackground) ? match.profileBackground.filter(Boolean).slice(0, 2) : [],
      focus: match.recentFocus || '', shared: narrative(copy?.relation || match.sharedRelation, synthetic),
      synthetic, contact: !synthetic && (match.sourceType === 'public' || match.contactable), previewOnly: false,
      sourceUrl, authorProfileUrl: safeZhihuUrl(match.authorProfileUrl),
      ...(match.sourceType === 'public' ? { publicReference: { url: sourceUrl, contentLabel: '知乎原文', linkLabel: '查看完整原文 ↗',
        title: '知乎里的这段表达', contextSummary: match.sharedRelation, visibilityNote: '',
        metrics: { upvotes: match.interactionFacts?.upvotes ?? '—', downvotes: '—', replies: match.interactionFacts?.comments ?? '—' } } } : {}) };
    messages.push({ role: 'agent', discovery: key === 'B' ? 'focus' : 'continue', delay: 320, typewriter: true, blocks: [
      { type: 'choice', text: key === 'B' ? '选择二' : '选择一' },
      ...(key === 'B' ? [{ type: 'turn', text: index ? '只是我又想到一个人。' : '我想到一个经历不同的人。' }] : []),
      { type: 'text', text: narrative(copy?.bridge || '这段表达可能与你有关。', synthetic) },
      { type: 'time', text: time },
      { type: 'quote', text: quote }, { type: 'text', text: narrative(copy?.relation || match.sharedRelation, synthetic) }
    ] });
  });
  return { candidates, messages };
}

// Disclosure belongs to the candidate card's persistent small-print label.
// Keep the quote intact; only normalize repeated technical labels in narration.
function narrative(text = '', synthetic) {
  return synthetic ? text.replace(/非真人样本|虚构样本|非真人/g, '纸条里的人') : text;
}
