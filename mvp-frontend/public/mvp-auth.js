// Same-origin session adapter used by the live MVP entry.
export function decodeSession(payload) {
  if (payload?.success !== true || typeof payload.user?.id !== 'string' || !payload.user.id.trim()) {
    return { status: 'error', reason: 'contract' };
  }
  const displayName = typeof payload.user.display_name === 'string' ? payload.user.display_name.trim().slice(0, 40) : '';
  const avatarUrl = validHttpsUrl(payload.user.avatar_url);
  return {
    status: 'authenticated',
    identity: {
      id: payload.user.id,
      name: displayName || 'Noah',
      avatarUrl,
      avatarKey: avatarUrl ? null : 'noah'
    }
  };
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function readSession(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('/api/auth-me', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) return { status: 'guest' };
    if (response.status === 403) return { status: 'error', reason: 'forbidden' };
    if (!response.ok) return { status: 'error', reason: 'unavailable' };
    if (!response.headers.get('content-type')?.includes('application/json')) return { status: 'error', reason: 'contract' };
    return decodeSession(await response.json());
  } catch {
    return { status: 'error', reason: 'unavailable' };
  }
}
