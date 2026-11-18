import { createHash } from 'node:crypto';
import {
  OAUTH_STATE_COOKIE,
  clearCookie,
  createSession,
  readCookie,
  preventAuthCaching,
  requireUser,
} from '../server/auth.mjs';
import { supabaseRequest } from '../server/supabase.mjs';
import { encryptToken } from '../server/token-crypto.mjs';

export default async function handler(request, response) {
  preventAuthCaching(response);
  if (request.method !== 'GET') return response.status(405).send('Method Not Allowed');

  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  const receivedState = firstString(request.query.state);
  if (!expectedState) {
    response.setHeader('X-OAuth-Error', 'STATE_COOKIE_MISSING');
    return response.status(400).send('知乎登录 state 校验失败：登录校验 Cookie 缺失或已过期。请在同一浏览器从本站登录按钮重新开始，并在 10 分钟内完成。');
  }
  if (!receivedState) {
    response.setHeader('X-OAuth-Error', 'STATE_PARAMETER_MISSING');
    return response.status(400).send('知乎登录 state 校验失败：授权回调缺少 state 参数。请联系应用管理员核对回调配置。');
  }
  if (Array.isArray(request.query.state) || expectedState !== receivedState) {
    response.setHeader('X-OAuth-Error', 'STATE_MISMATCH');
    return response.status(400).send('知乎登录 state 校验失败：本次授权与当前登录请求不一致。请关闭旧授权页，只从本站发起一次登录。');
  }
  clearCookie(response, OAUTH_STATE_COOKIE);

  const appId = process.env.ZHIHU_APP_ID;
  const appKey = process.env.ZHIHU_APP_KEY;
  const redirectUri = process.env.ZHIHU_REDIRECT_URI;
  if (!appId || !appKey || !redirectUri) return response.status(500).send('缺少知乎环境变量');

  const code = firstString(request.query.authorization_code) || firstString(request.query.code);
  if (!code) return response.status(400).send('知乎没有返回 authorization_code');

  try {
    const tokenResponse = await fetch('https://openapi.zhihu.com/access_token', {
      method: 'POST',
      redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenData.access_token !== 'string' || !tokenData.access_token.trim()) {
      return response.status(502).send('知乎授权失败，请查看 Vercel Function 日志');
    }

    const expiresIn = Number(tokenData.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 315360000) {
      response.setHeader('X-OAuth-Error', 'TOKEN_EXPIRY_INVALID');
      return response.status(502).send('知乎授权有效期缺失或无效，请重新授权。');
    }
    const identity = await resolveZhihuIdentity(tokenData);
    console.info(JSON.stringify({ type: 'oauth_identity', stable: !identity.externalId.startsWith('oauth_') }));
    const legacyUserId = await verifiedLegacyUser(request, identity, tokenData);
    const savedUser = await saveUserAndAccount(identity, tokenData, legacyUserId);
    if (!savedUser.ok) {
      return response.status(502).send(`知乎授权成功，但保存登录信息失败：${savedUser.error}`);
    }

    try {
      await createSession(savedUser.userId, response);
    } catch (error) {
      return response.status(502).send('创建登录会话失败，请稍后重新登录。');
    }

    await supabaseRequest('audit_events', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: { actor_user_id: savedUser.userId, event_type: 'oauth_login', resource_type: 'user',
        metadata: { stable_identity: !identity.externalId.startsWith('oauth_') } },
    }).catch(() => { console.warn('OAuth audit write unavailable'); });

    return response.redirect(302, new URL('/?login=success', getSiteUrl(request)).toString());
  } catch (error) {
    if (error?.code === 'ACCOUNT_LINK_REQUIRED') {
      response.setHeader('X-OAuth-Error', 'ACCOUNT_LINK_REQUIRED');
      return response.status(409).send('已获得知乎授权，但暂时无法确认它与原账号的对应关系。本次没有切换账号或合并历史，请联系项目维护者核验。');
    }
    response.setHeader('X-OAuth-Error', 'OAUTH_CONNECTION_FAILED');
    return response.status(502).send('知乎登录暂未完成，请稍后从登录按钮重新开始。');
  }
}

async function resolveZhihuIdentity(tokenData) {
  const tokenIdentity = stableId(tokenData, ["open_id", "openid", "user_id", "uid", "sub"]);
  if (tokenIdentity) {
    return { externalId: String(tokenIdentity), name: '知乎授权用户', avatarUrl: null, profileUrl: null };
  }

  const userResponse = await fetch('https://openapi.zhihu.com/user', {
    redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `${tokenData.token_type || 'Bearer'} ${tokenData.access_token}` },
  });
  const userInfo = await userResponse.json().catch(() => null);
  const apiCode = userInfo?.code ?? userInfo?.Code;
  if (userResponse.ok && userInfo && (apiCode === undefined || [0, 20000, '0', '20000'].includes(apiCode))) {
    const raw = userInfo.data || userInfo.Data || userInfo.user || userInfo.User || userInfo;
    const user = normalizeUser(raw);
    const externalId = stableId(user, ['id', 'user_id', 'userId', 'uid', 'open_id', 'openid', 'sub', 'url_token', 'urlToken']);
    if (externalId) {
      return {
        externalId: String(externalId),
        name: user.name || user.display_name || user.nickname || '知乎授权用户',
        avatarUrl: user.avatar_url || user.avatarUrl || user.avatar || null,
        profileUrl: user.url || user.profile_url || null,
      };
    }
  }

  // 当前应用收到 code 20004 时无法取得真实资料，只能使用不可逆 Token 哈希作为 Demo 身份。
  return {
    externalId: `oauth_${createHash('sha256').update(tokenData.access_token).digest('hex')}`,
    name: '知乎授权用户',
    avatarUrl: null,
    profileUrl: null,
  };
}

// A browser session alone is not proof that two OAuth grants belong to the same Zhihu account.
// Keep the existing UUID only after matching stable IDs, or the exact current OAuth token.
async function verifiedLegacyUser(request, identity, tokenData) {
  const current = await requireUser(request);
  const tokenKey = `oauth_${createHash('sha256').update(tokenData.access_token).digest('hex')}`;
  const exact = await supabaseRequest(`users?zhihu_user_id=eq.${encodeURIComponent(tokenKey)}&select=id&limit=1`);
  if (!exact.ok) throw new Error('ACCOUNT_LOOKUP_FAILED');
  let legacyId = Array.isArray(exact.data) ? exact.data[0]?.id : null;
  if (current && current.identityKey !== identity.externalId && !legacyId) {
    if (identity.externalId.startsWith('oauth_')) throw accountLinkRequired();
    if (current.identityKey?.startsWith('oauth_')) {
      const accounts = await supabaseRequest(`zhihu_accounts?user_id=eq.${encodeURIComponent(current.user.id)}&select=user_id,access_token,token_type,token_storage_version,expires_at&limit=1`);
      const old = accounts.ok && Array.isArray(accounts.data) ? accounts.data[0] : null;
      if (!old || old.user_id !== current.user.id || old.token_storage_version !== 'encrypted_v1' || (!Number.isFinite(Date.parse(old.expires_at)) || Date.parse(old.expires_at) <= Date.now())) throw accountLinkRequired();
      let prior;
      try {
        const { decryptToken } = await import('../server/token-crypto.mjs');
        prior = await resolveZhihuIdentity({ access_token: decryptToken(old.access_token), token_type: old.token_type });
      } catch { throw accountLinkRequired(); }
      if (prior.externalId.startsWith('oauth_')) throw accountLinkRequired();
      if (prior.externalId === identity.externalId) legacyId = current.user.id;
    }
  }
  if (!legacyId || identity.externalId === tokenKey) return null;
  const existing = await supabaseRequest(`users?zhihu_user_id=eq.${encodeURIComponent(identity.externalId)}&select=id&limit=1`);
  if (!existing.ok) throw new Error('ACCOUNT_LOOKUP_FAILED');
  if (existing.data?.[0] && existing.data[0].id !== legacyId) throw accountLinkRequired();
  const moved = await supabaseRequest(`users?id=eq.${encodeURIComponent(legacyId)}&zhihu_user_id=like.oauth_*`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { zhihu_user_id: identity.externalId }
  });
  if (!moved.ok || moved.data?.[0]?.id !== legacyId) throw accountLinkRequired();
  return legacyId;
}
function accountLinkRequired() { return Object.assign(new Error('ACCOUNT_LINK_REQUIRED'), { code: 'ACCOUNT_LINK_REQUIRED' }); }

async function saveUserAndAccount(identity, tokenData, legacyUserId) {
  const userResponse = await supabaseRequest('users?on_conflict=zhihu_user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      zhihu_user_id: identity.externalId,
      display_name: identity.name,
      avatar_url: identity.avatarUrl,
      profile_url: identity.profileUrl,
      updated_at: new Date().toISOString(),
    },
  });
  if (!userResponse.ok || !Array.isArray(userResponse.data) || !userResponse.data[0]?.id) {
    return { ok: false, error: `users 表写入失败（HTTP ${userResponse.status}）` };
  }

  const userId = userResponse.data[0].id;
  if (legacyUserId && userId !== legacyUserId) throw accountLinkRequired();
  const accountResponse = await supabaseRequest('zhihu_accounts?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      user_id: userId,
      access_token: encryptToken(tokenData.access_token),
      token_type: tokenData.token_type || 'Bearer',
      expires_at: tokenData.expires_in
        ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
        : null,
      token_storage_version: 'encrypted_v1',
      updated_at: new Date().toISOString(),
    },
  });
  return accountResponse.ok
    ? { ok: true, userId }
    : { ok: false, error: `zhihu_accounts 表写入失败（HTTP ${accountResponse.status}）` };
}

function normalizeUser(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

function stableId(user, keys) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
  for (const key of keys) {
    const value = user[key];
    if (typeof value === 'string' && value.trim() && value.length <= 200) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  }
  return null;
}

function firstString(value) {
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : '';
}

function getSiteUrl(request) {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  return `${firstString(request.headers['x-forwarded-proto']) || 'https'}://${request.headers.host}`;
}
