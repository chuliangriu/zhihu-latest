import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../public/mvp-api.js';

test('JSON API errors preserve status, stable code, Retry-After and request ID', async () => {
  const api = createApi(async () => new Response(JSON.stringify({ error: { code: 'SHORT_RATE_LIMITED' } }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '12', 'x-request-id': 'safe-request-id' }
  }));

  await assert.rejects(
    () => api.json('/api/chat/reply', { message: 'not retained by the client error object' }),
    error => error instanceof ApiError
      && error.status === 429
      && error.code === 'SHORT_RATE_LIMITED'
      && error.retryAfter === '12'
      && error.requestId === 'safe-request-id'
  );
});

test('SSE error frames preserve their request ID', async () => {
  const api = createApi(async () => new Response('event: error\ndata: {"code":"LLM_UPSTREAM_BUSY","requestId":"sse-request-id"}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'header-request-id' }
  }));

  await assert.rejects(
    () => api.chat(null, 'not retained by the client error object', () => {}),
    error => error instanceof ApiError
      && error.status === 200
      && error.code === 'LLM_UPSTREAM_BUSY'
      && error.requestId === 'sse-request-id'
  );
});

test('profile API errors retain only the allowed diagnostic metadata',async()=>{
 const api=createApi(async()=>Response.json({success:false,data:{reasonCode:'LLM_TIMEOUT_OR_ABORTED',requestId:'safe-request-03',diagnostics:{stage:'model',modelCalled:true,usableCount:5,token:'do-not-retain',raw:'private-content'}}},{status:503}));
 await assert.rejects(()=>api.json('/api/profile/summary',{}),error=>{
  assert.equal(error.requestId,'safe-request-03');assert.deepEqual(error.diagnostics,{stage:'model',modelCalled:true,usableCount:5});assert.doesNotMatch(JSON.stringify(error),/do-not-retain|private-content/);return true;
 });
});

test('profile schema issues show fields and limits without exposing rejected values',async()=>{
 const api=createApi(async()=>Response.json({success:false,data:{reasonCode:'LLM_SCHEMA_INVALID',diagnostics:{stage:'model',usableCount:4,modelCalled:true,schemaCorrectionAttempted:true,schemaIssues:[{path:'background.0.text',code:'too_big',maximum:80,received:'private-do-not-copy',message:'private-do-not-copy'},{path:'private-field-do-not-copy',code:'unrecognized_keys',keys:['private-do-not-copy']}]}}},{status:503}));
 await assert.rejects(()=>api.json('/api/profile/summary',{}),error=>{
  assert.deepEqual(error.diagnostics,{stage:'model',usableCount:4,modelCalled:true,schemaCorrectionAttempted:true,schemaIssues:[{path:'background.0.text',code:'too_big',maximum:80},{path:'*',code:'unrecognized_keys'}]});
  assert.doesNotMatch(JSON.stringify(error),/private-do-not-copy|private-field/);return true;
 });
});
