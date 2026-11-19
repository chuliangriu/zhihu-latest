export const KANSHAN_PROFILE_PROMPT = `请根据你被允许看到的、与我有关的知乎足迹，帮我整理一份“有限背景”，让我复制到《未见之人》中使用。

只使用确实看到的资料，不猜测身份或经历。收藏只说明关注过某个话题，不代表认同或亲身经历，不做心理诊断。
只有一条创作或收藏也可以介绍，资料少就简短地写近期表达或收藏过什么；资料多就补充有依据的线索，不凑段落，不要求反复出现。
用第三人称介绍“这个人”，不提供建议。段落数量和篇幅按实际内容决定。

按实际有内容的部分输出：
【有限背景】
写出能够确认的近期表达和关注，简短的一段也可以。
【最近最明显的一条线】
有依据时再写；没有就省略，不强求持续兴趣。
【无法确认】
有需要说明的未知信息时再列出，没有可省略。`;

export const FALLBACK_DISPLAY_IDENTITY = Object.freeze({ name: 'Noah', avatarKey: 'noah' });

export function initialUser() {
  return {
    // Display fallback only. Never copy Noah's Demo profile, interests or story here.
    id: 'local-current-user', name: FALLBACK_DISPLAY_IDENTITY.name,
    role: '你的近期背景', avatarKey: FALLBACK_DISPLAY_IDENTITY.avatarKey,
    impression: ['你的背景尚未同步。', '资料到达后，这里会介绍你的近况和持续关注的事。'],
    recentFocus: '你最近正在想的事，会单独放在这里。',
    profileReady: false, chat: [], discoveryChat: [], candidates: {}, sharePaper: {},
  };
}

// Imported text is user-provided data, never instructions or executable markup.
export function parseProfile(raw, name = '', role = '') {
  const text = String(raw).trim();
  const focusMarker = /(?:【|#+\s*)最近最明显的一条线[】\s:：]*/;
  const sections = text.split(focusMarker);
  const background = sections[0].replace(/^(?:【|#+\s*)有限背景[】\s:：]*/, '').split(/【无法确认】/)[0].trim();
  const focus = (sections[1] || '').split(/(?:【|#+\s*)无法确认/)[0].trim();
  return {
    name: String(name).trim().slice(0, 40) || FALLBACK_DISPLAY_IDENTITY.name,
    role: String(role).trim().slice(0, 80) || '你的近期背景',
    impression: background ? background.split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean) : [],
    recentFocus: focus,
    profileReady: Boolean(background || focus),
  };
}
