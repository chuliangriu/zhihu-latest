export const KANSHAN_PROFILE_PROMPT = `请根据你被允许看到的、与我有关的知乎足迹，帮我整理一份“有限背景”，让我复制到《未见之人》中使用。

请遵守这些规则：
1. 只使用你确实能看到的内容，不猜测我的年龄、职业、学校、城市、关系状态、健康情况或其他敏感信息。
2. 收藏和浏览只代表我看过，不等于我认同；不对我做心理诊断。
3. 重点收敛到最近最持续的一两条兴趣或困扰，不做面面俱到的画像，也不要给建议。
4. 使用第三人称介绍“这个人”，语气具体、克制。

严格按下面格式输出，不要添加开场白或结尾：

【有限背景】
两段，每段不超过 80 字。第一段写近期身份或生活背景中能够确认的部分；第二段写持续关注的兴趣和行为线索。

【最近最明显的一条线】
一段，不超过 90 字。写清楚最近反复出现的一个具体关注、投入或未解决的问题。

【无法确认】
列出你没有证据、因此没有写入的身份信息；没有则写“无”。`;

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
  const text = String(raw).trim().slice(0, 1600);
  const focusMarker = /(?:【|#+\s*)最近最明显的一条线[】\s:：]*/;
  const sections = text.split(focusMarker);
  const background = sections[0].replace(/^(?:【|#+\s*)有限背景[】\s:：]*/, '').split(/【无法确认】/)[0].trim();
  const focus = (sections[1] || '').split(/(?:【|#+\s*)无法确认/)[0].trim();
  return {
    name: String(name).trim().slice(0, 40) || FALLBACK_DISPLAY_IDENTITY.name,
    role: String(role).trim().slice(0, 80) || '你的近期背景',
    impression: background ? background.split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean) : [],
    recentFocus: focus || '接下来，可以从你最近正在想的事聊起。',
    profileReady: Boolean(background || focus),
  };
}
