import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../mvp-backend/dist/config.js';
import { createApp } from '../mvp-backend/dist/api/app.js';
import { OpenAiCompatibleProvider } from '../mvp-backend/dist/llm/openai-compatible-provider.js';
import { ChatService } from '../mvp-backend/dist/chat/service.js';
import { WorkflowService } from '../mvp-backend/dist/workflow/service.js';
import { LocalWorkflowStore } from './local-pool.mjs';
import { SupabaseWorkflowStore } from '../mvp-backend/dist/workflow/supabase-store.js';
import { identityHeaders } from '../mvp-backend/dist/security/identity.js';
import { runDiscoveryPipeline } from '../mvp-backend/dist/pipeline/discovery-pipeline.js';
import { RoutedCandidateSource, loadSeedCandidates } from '../mvp-backend/dist/sources/routed-source.js';
import { ZhihuPublicSearchProvider, ZhihuCliPublicSearchProvider } from '../mvp-backend/dist/sources/zhihu-public-search.js';

// This bridge runs on loopback only. Production uses the real wjr_session.
// Secrets are loaded server-side and are never returned to the browser.
export function createLocalBackend(origin) {
  if (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
    throw new Error('The local backend bridge is only available on loopback in development');
  }
  const require = createRequire(new URL('../mvp-backend/package.json', import.meta.url));
  require('dotenv').config({ path: fileURLToPath(new URL('../mvp-backend/.env.local', import.meta.url)), quiet: true });
  const allowed = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_ALLOWED_HOSTS', 'LLM_MODEL', 'LLM_INPUT_COST_PER_MILLION_USD', 'LLM_OUTPUT_COST_PER_MILLION_USD', 'ZHIHU_ACCESS_SECRET', 'ZHIHU_PUBLIC_SEARCH_ENABLED', 'ZHIHU_PUBLIC_SEARCH_TRANSPORT', 'ZHIHU_CLI_PATH', 'ZHIHU_PUBLIC_DEMO_TIME_ENABLED', 'PUBLIC_SOURCE_PROBABILITY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BUSINESS_STORE_MODE', 'LOCAL_TEST_USER_ID'];
  const modelEnv = Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const config = loadConfig({
    ZHIHU_PUBLIC_SEARCH_ENABLED:process.env.ZHIHU_ACCESS_SECRET?'true':'false', ZHIHU_PUBLIC_DEMO_TIME_ENABLED:'true',
    ZHIHU_PUBLIC_SEARCH_TRANSPORT:'http',
    ZHIHU_CLI_PATH:join(homedir(),'Library','Application Support','zhihu-cli','current','zhihu-cli'),
    ...modelEnv, NODE_ENV: 'development', LLM_MODE: 'live',
    LLM_TIMEOUT_MS: '60000', PIPELINE_TIMEOUT_MS: '90000', LLM_MAX_RETRIES: '0',
    APP_API_TOKEN: randomBytes(32).toString('hex'), IDENTITY_SIGNING_SECRET: randomBytes(32).toString('hex'),
    IP_HASH_SECRET: randomBytes(32).toString('hex'), CORS_ORIGINS: origin,
    RATE_USER_MAX: '15', RATE_IP_MAX: '80', DAILY_USER_WORKFLOWS: '100', DAILY_IP_WORKFLOWS: '200',
    DAILY_USER_LLM_REQUESTS: '200', DAILY_USER_INPUT_TOKENS: '2000000', DAILY_USER_OUTPUT_TOKENS: '300000',
    RESERVATION_LEASE_MS: '180000' });
  const sessions = new Map();
  const workflowStore = new LocalWorkflowStore();
  const llm = () => new OpenAiCompatibleProvider(config.llm);
  const runtime = { async evaluateDetailed(request, principal) {
    const { publicCandidates, synthetic } = await loadSeedCandidates(Date.now,config.publicDemoTimeEnabled);
    const source = new RoutedCandidateSource(principal.userId, workflowStore, publicCandidates, synthetic, {
      publicProbability:config.publicSourceProbability, allowPublicDemoTime:config.publicDemoTimeEnabled,
      ...(config.publicSearchEnabled?{publicProvider:config.publicSearchTransport==='local_cli'
        ? new ZhihuCliPublicSearchProvider(config.zhihuCliPath,Date.now,config.publicDemoTimeEnabled)
        : new ZhihuPublicSearchProvider(config.profile.accessSecret,fetch,Date.now,config.publicDemoTimeEnabled)}:{})
    });
    let trace;
    const result = await runDiscoveryPipeline(request, { llm: llm(), candidateSource: source,
      timeoutMs: config.pipelineTimeoutMs, dataMode: 'routed', publicRecentDays: 14,
      allowPublicDemoTime:config.publicDemoTimeEnabled,
      trustedContext: { allowDiscovery: true, safetyPassed: true }, onTrace: value => {
        value.stages.push({name:'candidate_route',durationMs:0,note:source.decision??'not_searched'});
        if(source.publicOrigin)value.stages.push({name:'public_origin',durationMs:0,note:source.publicOrigin});
        if(source.zhihuSearchRequests)value.stages.push({name:'zhihu_public_search',durationMs:0,zhihuSearchRequests:source.zhihuSearchRequests,note:source.publicSearchReason??'completed'});
        trace = value;
      } });
    return { result, trace };
  } };
  const app = createApp({ config, runtime, workflowStore,
    chatService: new ChatService(workflowStore, llm), workflowService: new WorkflowService(workflowStore, llm) });
  const allowedRoutes = /^(?:\/api\/chat\/reply|\/api\/profile\/summary|\/api\/mailbox|\/api\/conversations\/[a-f0-9-]+(?:\/discovery)?|\/api\/discoveries\/[a-f0-9-]+\/candidates\/[a-f0-9-]+|\/api\/discussions(?:\/[a-f0-9-]+(?:\/replies)?)?|\/api\/papers\/drafts|\/api\/papers\/[a-f0-9-]+(?:\/confirm|\/withdraw)?|\/api\/handoffs)$/i;
  return (request, response) => {
    const url = new URL(request.url, origin);
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') {
      json(403, { error: { code: 'ORIGIN_FORBIDDEN' } }); return;
    }
    const token = (request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('unseen_local='))?.slice(13);
    let session = token && sessions.get(token);
    if (session && session.expires <= Date.now()) { sessions.delete(token); session = null; }
    if (url.pathname === '/api/auth-me' && request.method === 'GET') {
      if (!session) {
        for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
        if (sessions.size >= 100) { json(429, { error: { code: 'LOCAL_SESSION_LIMIT' } }); return; }
        const cookie = randomBytes(32).toString('base64url');
        session = { userId: process.env.LOCAL_TEST_USER_ID || randomUUID(), sessionId: randomUUID(), expires: Date.now() + 86400000 };
        sessions.set(cookie, session);
        response.setHeader('Set-Cookie', `unseen_local=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
      }
      json(200, { success: true, localDevelopment: true, user: { id: session.userId, display_name: '本地用户', avatar_url: null, profile_url: null } }); return;
    }
    if (!session) { json(401, { error: { code: 'NOT_LOGGED_IN' } }); return; }
    if (!allowedRoutes.test(url.pathname)) { json(404, { error: { code: 'NOT_FOUND' } }); return; }
    if (request.method !== 'GET' && request.headers.origin !== origin) { json(403, { error: { code: 'ORIGIN_FORBIDDEN' } }); return; }
    for (const key of Object.keys(request.headers)) if (key.startsWith('x-unseen-') || key === 'authorization' || key === 'x-forwarded-for') delete request.headers[key];
    const signedHeaders = identityHeaders(config.identity.signingSecret, config.appApiToken, {
      method: request.method, path: url.pathname, userId: session.userId, sessionId: session.sessionId
    });
    // IncomingMessage keys are lowercase; Express reads those exact keys.
    for (const [key, value] of Object.entries(signedHeaders)) request.headers[key.toLowerCase()] = value;
    app(request, response);
  };
}
