export const KANSHAN_PROFILE_PROMPT = `请根据你被允许看到的、与我有关的知乎足迹，帮我整理一份“有限背景”，让我复制到《未见之人》中使用。

写作目标：让陌生人读完后认识“这是一个怎样的人”——目前能确认的背景、兴趣，以及有依据的思考或做事倾向。
先理解资料，再把它们归纳成连贯的人物介绍。围绕这个人关注什么、怎样思考、最近在探索什么组织内容；把不同话题之间有依据的联系写清楚，不逐条罗列发过什么、收藏过什么，不堆砌文章标题、日期或条数。
语气自然、具体、克制。少用“用户近期”“可见”“接触线索”等报告式措辞，不追求诗意、比喻或文学修饰。
只使用确实看到的资料，不猜测身份或经历。性格方面，只归纳本人明确表达或具体行为能支持的思考、做事倾向；不能只凭几条收藏断言内向、外向、焦虑或其他稳定性格。收藏可支持近期兴趣，不能证明认同、亲身经历或情绪，不做心理诊断。
一条创作或收藏也可以整理背景。资料少就简短介绍确实知道的部分，资料多就丰富有依据的内容，不要求反复出现或持续兴趣，不为填满版式补造特征。
用第三人称介绍“这个人”，不提供建议。最终格式固定如下，不得省略两段背景和一段关注：

【有限背景】
两段，每段不超过80字。第一段介绍可确认的背景、近况，以及有依据的思考或做事倾向；第二段介绍兴趣、关注的问题及其联系。资料不支持的部分不编造，也不为凑人物画像强行贴性格标签。
【最近最明显的一条线】
一段，不超过90字。提炼最近正在接触或探索的一个具体主题，写清楚这些关注指向什么，不重复罗列阅读记录；只有单条资料时，不把它夸大成长期兴趣。
【无法确认】
仅从年龄、职业、学校、城市、关系状态、健康情况这六类中列出没有证据的信息，最多6项；没有需列出的项目时写“无”。`;

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

// Keep the fixed card layout and its original per-section character limits.
export function profileCardSections(background, focus = '') {
  const paragraphs = background.map(text => String(text).replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return {
    impression: [(paragraphs[0] || '当前可确认的背景线索集中在下面这段近期关注中。').slice(0, 80), (paragraphs.slice(1).join(' ') || '更多个人背景与近况仍待你补充。').slice(0, 80)],
    recentFocus: (String(focus || '').replace(/\s*\n\s*/g, ' ').trim() || '最近最明显的一条线仍待你补充。').slice(0, 90),
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
    ...profileCardSections(background ? background.split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean) : [], focus),
    profileReady: Boolean(background || focus),
  };
}
