const mockUsers = [
  {
    id: 'xutang', name: 'Noah', initials: 'N', avatarKey: 'noah', role: '毕业第二年 · 夜里写作的人',
    background: '一直在写喜欢的东西，但很少有人看见。', detail: 'TA 开始怀疑，没人回应是不是意味着这件事没有价值。',
    impression: [
      'Noah 毕业两年，白天做内容运营，晚上却把大部分空闲时间留给了一部长篇。它已经写了十一个月、十几万字，这不像一时兴起，更像一件一直没有从生活里退场的事。',
      '他平时会看地方志、慢节奏小说和叙事游戏，也收藏内容策划的方法。看起来他既在意故事怎样被留下，也会忍不住研究它怎样才能抵达别人。',
      '还是《退潮信箱》。阅读量很少，大纲也改过很多次；他似乎不是已经不想写了，而是越来越难判断：只有自己知道它为什么重要，这份重要还算不算数。',
    ],
    chat: [
      { role: 'user', text: '我写了一本几乎没人看的小说。没有推荐，也没有什么热度，阅读量少到我几乎记得后台每一次变化。我还要不要继续写？' },
      { role: 'agent', paragraphs: [
        '这个话题有点戳到我了，让我先去找找知乎上有没有人聊过类似的经历。',
        '说实话，看到你说“阅读量少到几乎记得后台每一次变化”，我愣了一下。你投入的不只是时间，还有心气。',
        '知乎上的讨论大多会把“没人看”拆成曝光、写法，以及你是否还相信这个故事……如果只留下一个判断标准：你还想知道故事里的人最后会怎样吗？如果答案还是“想”，先别急着删掉它。',
      ] },
      { role: 'user', text: '还想。它叫《退潮信箱》，写一个夜间邮差给已经消失的街道送信。里面有一句：“第 47 封信：地址已经消失，收件人仍然存在。”我大概就是放不下这个。' },
      { role: 'agent', text: '这样我更明白，你刚才为什么会问“还要不要继续写”了。你放不下的，好像不只是一本没有热度的小说，也是那些还没有抵达的信。' },
    ],
    discoveryChat: [
      { role: 'agent', discovery: 'start', blocks: [
        { type: 'text', text: 'Noah，还有一件事儿。刚才在帮你找别人的经历时，我听到其他“看山”告诉我：' },
        { type: 'lead', text: '这周，还有 6 个和你一样的人，也卡在这儿。' },
      ], delay: 2000 },
      { role: 'agent', discovery: 'continue', blocks: [
        { type: 'choice', text: '选择一' },
        { type: 'text', text: '我想起了其中一个还在写的人。' },
        { type: 'time', text: '2 天前' },
        { type: 'text', text: '他曾经把一句没有说完的话留给他的“看山”，希望有一天能遇到真正相关的人。和你一样，他也在写作，也在想：没有人看的时候，还要不要继续。' },
        { type: 'quote', text: '我知道现在没人看，可每次准备停下来，还是会想，也许再写一点就会有人遇见它。' },
      ], delay: 2200, typewriter: true },
      { role: 'agent', discovery: 'focus', blocks: [
        { type: 'choice', text: '选择二' },
        { type: 'turn', text: '只是我又想到一个人。' },
        { type: 'text', text: '他没有在写小说，但和你一样的是，他也在做一件暂时没人看见、却还舍不得放下的事。' },
        { type: 'time', text: '3 天前，他这样说：' },
        { type: 'quote', text: '我已经把能做的那部分做完了，可一直没有回应。我不知道自己是不是做对了，也不知道下一步该往哪里走。' },
        { type: 'text', text: '你们经历的事不同，却都在等一个能判断下一步的回声。' },
      ], delay: 2700, typewriter: true },
    ],
    candidates: {
      A: { name: '一个还在写的人', time: '昨天', quote: '我知道现在没人看，可每次准备停下来，还是会想，也许再写一点就会有人遇见它。', context: '匿名 · 下班后持续创作', shared: '你们都在做一件暂时没有得到足够回应、但仍然舍不得放下的事。', contact: true, previewOnly: true },
      B: {
        name: 'Mika', avatarKey: 'mika', time: '3 天前', quote: '我默默做了很多事，也帮了不少人。事情一件件过去，却很少有人说这些帮上了什么忙。我不知道大家是觉得这样就好，还是这些付出其实没有那么重要。', context: '工作第一年 · 产品助理',
        profile: 'Mika 刚开始工作一年，做产品助理。读书时，小组作业里补材料、社团活动后收拾场地，她总会默默接下来。活动结束，大家记得台上的人，那些让事情顺利发生的小事却很少被提起。现在她依然会帮同事补齐交接、赶上进度，只是做完之后，常常还是没有回声。',
        focus: '最近最让她拿不准的，是这份熟悉的沉默。以前活动办成了，她还能告诉自己，做了就有用；工作以后，她更想知道自己的付出究竟帮上了什么。大家没说什么，是默认这样就好、暂时顾不上，还是这些事真的没有那么重要？',
        shared: '你们做的事情不同，却都把一件对自己重要的东西交了出去，再等待一个可以判断下一步的回声。', contact: true
      },
    },
    sharePaper: {
      subject: '《退潮信箱》',
      quote: '我写了十一个月的《退潮信箱》。我还想知道故事里的人最后会怎样，只是越来越难判断：当一直没人看见时，只有自己知道的这份重要，还算不算数。',
      context: '毕业第二年 · 白天做内容运营，夜里写作',
      background: 'Noah 毕业两年，白天做内容运营。工作之外，他会看地方志、慢节奏小说和叙事游戏，也会研究内容怎样才能抵达别人。过去十一个月，他把大部分晚上和周末都留给了《退潮信箱》。这部长篇已经写到十几万字，大纲和章节顺序改过很多次。Noah 并不是不想写了；真正让他动摇的，是作品迟迟没有抵达别人。',
    },
  },
  {
    id: 'iris', name: 'Iris', initials: 'I', avatarKey: 'iris', role: '大四 · 喜欢观察空间的人',
    background: '家里的客厅最大、采光最好，却很少有人停留。', detail: 'TA 好奇的不是家具怎么摆，而是一个空间为什么还能把人留在一起。',
    impression: [
      'Iris 正在读建筑学大四，最近持续关注居住空间、校园公共区域和人与空间的关系。比起一张完成得很漂亮的平面图，她似乎更容易注意到：一个地方最后到底有没有人真的使用。',
      '但她看的不全是建筑。收藏里还有家庭生活、城市观察和一些写作内容。她喜欢追着一个很小的现象往外看，比如桌椅明明摆在那里，人为什么还是只想经过。',
      '是她重新注意到了家里的客厅。那里最大、采光最好，一家人回家后却常常各自进房间。她想弄明白的可能不是家具怎么摆，而是一个空间为什么还能把人留在一起。',
    ],
    chat: [
      { role: 'user', text: '上周我妈把一盆快枯的绿萝搬到客厅窗边修剪。我爸本来只是路过，说她剪得太狠，两个人就蹲在地上你一句我一句，我也慢慢坐了过去。那天谁都没说要一起待会儿，三个人却就这样在客厅里耗了十几分钟。第二天我再经过时，客厅又空了。我一直在想，那十几分钟到底是怎么发生的。' },
      { role: 'agent', paragraphs: [
        '这个片段挺有意思。让我先去找找知乎上有没有人聊过类似的经历。',
        '知乎上关于客厅的讨论，大多会落到电视、沙发或具体活动上。但回到你说的那十几分钟，也许关键不只是绿萝，而是它被搬到了客厅：在一个全家都能看见、也不属于某个人的地方摊开。你爸能停下来插一句，你也能自然地坐进去；如果它还放在某个人的房间里，这段时间可能就不会发生。',
        '这样看，客厅那晚并没有把你们安排在一起；它只是让一件没做完的小事进入所有人的视线，也让加入不需要正式邀请。第二天它又空下来，也没有推翻前一晚。客厅也许不是持续聚人的容器，而是让原本各自生活的人偶尔撞见彼此、短暂参与的地方。你想知道的，可能是这种机会能不能不只靠运气。',
      ] },
      { role: 'user', text: '这样说，客厅的意义可能不是每天坐满人，而是让彼此正在做的事能被看见、被加入。可如果空间只能提供机会，设计具体还能做什么？' },
      { role: 'agent', text: '它不能命令谁靠近，但能决定一件事容不容易被看见、停下和参与：活动是否藏在门后，路过时有没有顺手坐下的位置，加入是否需要先打断别人。设计不制造亲密，却可以少设几道阻碍，让那盆绿萝式的偶然更容易发生。' },
    ],
    discoveryChat: [
      { role: 'agent', discovery: 'start', blocks: [
        { type: 'text', text: 'Iris，刚才那句“空间只能提供机会”，让我又多找了一会儿。' },
        { type: 'lead', text: '我在看山们的信箱和知乎的讨论里，各看到了一句还没有答案的话。' },
      ], delay: 2000 },
      { role: 'agent', discovery: 'continue', blocks: [
        { type: 'choice', text: '选择一' },
        { type: 'text', text: '我想起了其中一个也在观察空间的人。' },
        { type: 'time', text: '2 天前' },
        { type: 'text', text: '他把一句还没想明白的话留给了他的“看山”。和你一样，他也在观察：一个地方明明可以坐下来，为什么人们还是只想经过。' },
        { type: 'quote', text: '我最近总在观察学校里那些没人停下来的公共区域。明明放了桌椅，大家还是只把它当作一条走廊。' },
      ], delay: 2200, typewriter: true },
      { role: 'agent', discovery: 'focus', blocks: [
        { type: 'choice', text: '选择二' },
        { type: 'turn', text: '不过，我还在知乎的一篇文章下面看到了一句话。' },
        { type: 'text', text: '那篇文章在讨论，一段文字怎样让读者愿意继续读下去。这句话没有得到赞同或回复，在按互动和热度展开的评论区里，很快沉到了难以被翻到的位置。' },
        { type: 'time', text: '3 天前，他在评论里这样说：' },
        { type: 'quote', text: '我最近在想，一段文章怎样让读者愿意多停留一会儿。不是用磕绊困住他，而是让信息自然流动。' },
        { type: 'text', text: '你在想家人为什么愿意留在客厅，他在想读者为什么愿意留在文字里。对象不同，但你们都在找一个自愿留下的理由。' },
      ], delay: 2700, typewriter: true },
    ],
    candidates: {
      A: { name: 'Theo', avatarKey: 'theo', time: '2 天前', quote: '我最近总在观察学校里那些没人停下来的公共区域。明明放了桌椅，大家还是只把它当作一条走廊。', context: '建筑系大四 · 正在记录校园公共空间', shared: '你们都在观察一个拥有空间、却没有自然形成共同活动的地方，也都在追问人为什么愿意留下。', contact: true, previewOnly: true },
      B: { name: 'June', avatarKey: 'june', time: '3 天前', quote: '我最近在想，一段文章怎样让读者愿意多停留一会儿。不是用磕绊困住他，而是让信息自然流动。', shared: '你在想一个房间怎样让家人愿意留下，June 在想一段文字怎样让读者愿意留下。你们关心的对象不同，却都在找一个自愿留下的理由。', contact: false,
        publicReference: {
          contentType: 'article-comment', contentLabel: '知乎 · 文章评论',
          title: '一篇文章，怎样才能让读者愿意继续读下去？',
          url: 'https://www.zhihu.com/question/45382314/answer/100891132',
          linkLabel: '查看改编参考 ↗',
          contextSummary: '这篇文章在讨论：当资料和观点都不少时，怎样安排信息，才能让读者不被卡住，并愿意继续读到最后。',
          visibilityNote: '发布 3 天后，这条评论的赞同、反对和回复仍然都是 0。在按互动和热度展开的评论区里，它渐渐落到了很难被翻到的位置。',
          metrics: { upvotes: 0, downvotes: 0, replies: 0 },
          isAdapted: true,
        },
      },
    },
    sharePaper: {
      subject: '客厅为什么还能让人留下',
      quote: '我开始重新留意家里的客厅。那里最大、采光最好，大家回家后却常常各自进房间。我想知道，一个空间到底靠什么让人愿意留下。',
      context: '建筑学大四 · 持续观察空间与人的关系',
      background: 'Iris 正在读建筑学大四，平时会看居住空间、校园公共区域，也留意家庭生活和城市里的日常。最近，她重新注意到家里的客厅：那里最大、采光最好，一家人回家后却常常各自进房间。她关心的不是家具该怎么摆，而是共同生活的旧中心消失以后，人为什么还会选择待在一起。',
    },
  },
];

const state = { screen: 'home', currentUser: null, stage: 0, selected: null, privateDraft: '', privateMessages: [], publicDraft: '', publicReplies: [], timer: null, avatarStyle: 'paper', chatOpen: true, typewriterStage: null, typedChars: 0 };
const app = document.querySelector('#app');
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const current = () => mockUsers.find((user) => user.id === state.currentUser);
const avatar = (person, size = '') => person?.avatarKey ? `<img class="avatar-img ${size}" src="/avatars/${state.avatarStyle}-${person.avatarKey}.png" alt="${esc(person.name)}"/>` : '';
const mailboxIcon = () => `<svg class="mailbox-mini-icon" viewBox="0 0 28 28" aria-hidden="true"><path d="M3.5 12.5a7 7 0 0 1 7-7h6a8 8 0 0 1 8 8v9H3.5z"/><path d="M10.5 5.5a7 7 0 0 1 7 7v10M8 12h6M20 8V3.5h4"/></svg>`;
const messageParts = (message) => message.blocks || (message.paragraphs || [message.text]).map((text) => ({ type: 'paragraph', text }));
const messageLength = (message) => messageParts(message).reduce((total, part) => total + [...part.text].length, 0);
const messageBody = (message, characterLimit = Infinity) => {
  let remaining = characterLimit;
  return messageParts(message).map((part) => {
    if (remaining <= 0) return '';
    const characters = [...part.text];
    const visible = characters.slice(0, remaining).join('');
    remaining -= characters.length;
    if (!visible) return '';
    if (part.type === 'quote') return `<blockquote class="kanshan-found-quote">“${esc(visible)}${visible.length === characters.length ? '”' : ''}</blockquote>`;
    if (part.type === 'paragraph') return `<p>${esc(visible)}</p>`;
    return `<p class="kanshan-found-${esc(part.type)}">${esc(visible)}</p>`;
  }).join('');
};

// Both personas use Noah's approved message layout. Only the text/source varies.
function chatMessage({ message, characterLimit }, index, messages) {
  const continuation = message.role === 'agent' && messages[index - 1]?.message.role === 'agent';
  const discoveryClass = message.discovery ? ` discovery-${message.discovery}` : '';
  const streamingClass = characterLimit !== Infinity ? ' is-streaming' : '';
  return `<div class="kanshan-message ${message.role}${continuation ? ' continuation' : ''}${discoveryClass}${streamingClass}">${message.role === 'agent' && !continuation ? '<span class="kanshan-speaker">看山</span>' : ''}${messageBody(message, characterLimit)}</div>`;
}

function header() {
  const user = current();
  return `<header><button class="brand" data-action="reset">未见之人</button>${user ? `<span class="identity-pill">${avatar(user)}${esc(user.name)}</span>` : ''}${state.screen !== 'home' ? '<button class="reset" data-action="reset">重新开始</button>' : ''}</header>`;
}

function render() {
  document.body.dataset.screen = state.screen;
  const chatSceneScreens = ['chat', 'card', 'consent', 'share', 'deposit', 'delivered', 'private', 'public-preview', 'public'];
  app.classList.toggle('chat-scene-active', chatSceneScreens.includes(state.screen));
  let html = chatSceneScreens.includes(state.screen) ? '' : header();
  if (state.screen === 'home') html += home();
  if (state.screen === 'login') html += login();
  if (state.screen === 'chat') html += chat();
  if (state.screen === 'card') html += chat(candidateOverlay(current().candidates[state.selected]));
  if (state.screen === 'consent') html += chat(consentOverlay(current().candidates[state.selected]));
  if (state.screen === 'share') html += chat(sharePaperOverlay());
  if (state.screen === 'deposit') html += chat(depositOverlay());
  if (state.screen === 'delivered') html += chat(deliveredOverlay(current().candidates[state.selected]));
  if (state.screen === 'private') html += privateChat(current().candidates[state.selected]);
  if (state.screen === 'public-preview') html += publicDiscussion(current().candidates[state.selected], true);
  if (state.screen === 'public') html += publicDiscussion(current().candidates[state.selected]);
  app.innerHTML = html;
  bind();
}

function home() {
  const stories = ['等待一个看见作品的人', '想知道人为什么愿意停留'];
  return `<main class="home paper-home">
    <section class="paper-hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="paper-kicker"><span aria-hidden="true">✳</span> 刘看山说：</p>
        <p class="hero-prelude">在知乎，答案和有答案的人已经很多了。</p>
        <h1 id="home-title">但是此刻，在知乎，还有谁<br/><span>在想你正在想的事？</span></h1>
        <p class="hero-description">有些人的生活与你不同，<br/>却可能和你停在同一个地方。</p>
        <a class="explore-link" href="#stories">从一个故事开始 <span aria-hidden="true">↓</span></a>
      </div>
      <div class="hero-illustration">
        <span class="pencil-note">嘿，去看看别人吧。</span>
        <div class="mascot-window" role="img" aria-label="戴着灰蓝围巾的白色刘看山，轻轻招手"><img src="/paper-assets/kanshan.png" alt=""/></div>
        <span class="mascot-caption">我帮你发现。接下来，交给你们。</span>
      </div>
    </section>
    <section id="stories" class="story-section" aria-labelledby="story-title">
      <div class="story-heading"><div><h2 id="story-title">先借一个人的视角，走进去。</h2></div></div>
      <div class="people-grid">${mockUsers.map((user, index) => `<article class="person-card story-${index}">
        <div class="story-person"><div class="story-avatar">${avatar(user)}</div><div><h3>${esc(user.name)}</h3><p class="person-role">${esc(user.role)}</p></div><span class="story-number" aria-hidden="true">0${index + 1}</span></div>
        <div class="story-copy"><span class="story-label">${stories[index]}</span><p class="person-background">${esc(user.background)}</p><p class="person-detail">${esc(user.detail)}</p></div>
        <button class="primary" data-action="choose" data-id="${user.id}">走进 ${esc(user.name)} 的故事 <span aria-hidden="true">↗</span></button>
      </article>`).join('')}</div>
    </section>
    <footer class="home-footer"><p>生活不同，也可能在同一处停留。</p><span>概念 Demo · 预设人物与对话 · 无需登录</span></footer>
  </main>`;
}

function login() {
  const user = current();
  const background = user.impression.slice(0, -1).map((item) => `<p>${esc(item)}</p>`).join('');
  const recentFocus = user.impression.at(-1);
  return `<main class="login-page"><button class="back" data-action="back-home">← 返回人物选择</button><div class="login-card"><div class="login-person">${avatar(user, 'large')}<div><p class="eyebrow">Demo 人物背景</p><h1>${esc(user.name)}</h1><p class="login-role">${esc(user.role)}</p></div></div><div class="impression-copy">${background}</div><section class="impression-focus"><span>最近最明显的一条线</span><p>${esc(recentFocus)}</p></section><p class="impression-caveat">这是进入故事前的有限背景，不是 ${esc(user.name)} 的完整画像。接下来，你会看到 TA 和刘看山聊起最近最困扰自己的事。</p><button class="primary login-button" data-action="enter-chat">进入与看山的聊天 <b>→</b></button></div></main>`;
}

function zhihuBackdrop() {
  const topics = ['工作里有哪些让你慢慢想明白的事？', '那些一直坚持的小爱好，后来怎么样了？', '可以分享一个最近被生活打动的瞬间吗？'];
  return `<div class="zh-backdrop" aria-hidden="true" inert>
    <div class="zh-nav"><span class="zh-logo">知乎</span><span>关注</span><strong>推荐</strong><span>热榜</span><span>专栏</span><span>圈子</span><span class="zh-search">搜索你感兴趣的内容 <i>⌕</i></span><span class="zh-ask">＋</span><span>消息</span><span>私信</span></div>
    <div class="zh-feed"><div class="zh-feed-main"><div class="zh-banner"><small>知乎 · 开学季</small><b>新的故事，从一个问题开始。</b><span>记录生活里的好奇心</span></div><div class="zh-publish"><p>分享此刻的想法…</p><div><span>提问题</span><span>写回答</span><span>写文章</span><span>发视频</span></div></div>
    ${topics.map(title => `<article class="zh-article"><h2>${title}</h2><p>每个人都在自己的生活里，留下了一些经历和思考。有些问题还在继续，有些想法值得慢慢说。</p><div class="zh-textline"></div><footer><span>▲ 赞同</span><span>评论</span><span>收藏</span><span>分享</span></footer></article>`).join('')}</div>
    <aside class="zh-sidebar"><section><b>创作中心</b><div class="zh-stats"><span>今日阅读<br><strong>—</strong></span><span>今日新增赞同<br><strong>—</strong></span></div><div class="zh-outline">进入创作中心 ›</div></section><section><b>大家都在搜</b>${['如何找到自己的生活节奏','毕业后的第一份工作','把热爱留在生活里','那些没有说完的话','最近读过什么好书','分享一件小事'].map((s,i) => `<p><em>${i+1}</em>${s}</p>`).join('')}</section><section><b>让每一次表达被看见</b><p>在知乎，分享你的知识、经验和见解。</p></section></aside></div></div>`;
}

function chat(overlayContent = '') {
  const user = current();
  const sequence = [...user.chat, ...(user.discoveryChat || [])];
  const messages = sequence.slice(0, state.stage).map((message) => ({ message, characterLimit: Infinity }));
  if (state.typewriterStage === state.stage && sequence[state.stage]) {
    messages.push({ message: sequence[state.stage], characterLimit: state.typedChars });
  }
  const done = state.stage >= sequence.length;
  return `<main class="kanshan-scene ${state.chatOpen ? 'is-open' : 'is-collapsed'}">
    ${zhihuBackdrop()}<div class="zh-haze" aria-hidden="true"></div>
    <div class="scene-tools"><button data-action="back-home">← 切换人物</button><span>知乎界面模拟 · ${esc(user.name)}</span></div>
    ${state.chatOpen ? `<section class="kanshan-window${overlayContent ? ' is-obscured' : ''}" aria-label="与看山的聊天"${overlayContent ? ' aria-hidden="true" inert' : ''}>
      <div class="kanshan-titlebar"><span class="kanshan-current">${avatar(user)}<span>${esc(user.name)}</span></span><h1>看山</h1><div><button data-action="replay-chat" aria-label="重新播放对话" title="重新播放">↻</button><button data-action="collapse-chat" aria-label="收起聊天窗" title="收起">⌄</button></div></div>
      <div class="kanshan-body" role="log" aria-label="演示聊天记录" aria-live="polite">
        <div class="kanshan-greeting"><span class="paper-kanshan" role="img" aria-label="纸绘刘看山"></span><div><h2>你好，${esc(user.name)}</h2><p>今天，有什么想聊聊的？</p></div></div>
        <div class="kanshan-messages">${messages.map(chatMessage).join('')}${!done && state.typewriterStage === null ? '<div class="kanshan-typing">看山正在想<span>···</span></div>' : ''}</div>
        ${done && !state.selected ? `<div class="kanshan-choices"><p>你想先听谁说下去？</p><div><button data-action="view" data-id="A">第一个人</button><button data-action="view" data-id="B">第二个人</button></div></div>` : ''}
        ${done && state.selected && !overlayContent ? `<p class="kanshan-choice-locked">你刚才选择了${state.selected === 'B' ? '第二个人' : '第一个人'}。这一次相遇已经继续向前了。</p>` : ''}
      </div>
      <div class="kanshan-composer"><div class="kanshan-input"><textarea aria-label="演示输入框" placeholder="畅所欲问" readonly></textarea><button disabled aria-label="演示模式暂不支持发送">↑</button></div><p>演示对话 · 内容为预设脚本，暂不支持自由提问</p></div>
    </section>` : '<div class="kanshan-reopen-hint">点击右下角的看山，继续刚才的对话 ↘</div>'}
    <button class="kanshan-launcher" data-action="toggle-chat" aria-label="${state.chatOpen ? '收起看山' : '打开看山'}" aria-expanded="${state.chatOpen}"${overlayContent ? ' tabindex="-1" aria-hidden="true"' : ''}><img src="/chat-assets/kanshan-official.png" alt=""/></button>
    ${overlayContent}
  </main>`;
}

function candidateOverlay(candidate) {
  const inactive = candidate.previewOnly ? ' disabled aria-disabled="true"' : '';
  const publicSource = candidate.sourceUrl ? `<a class="source-link" href="${esc(candidate.sourceUrl)}" target="_blank" rel="noreferrer">查看知乎原文 ↗</a>` : '';
  const referenceSource = candidate.referenceUrl ? `<a class="source-link" href="${esc(candidate.referenceUrl)}" target="_blank" rel="noreferrer">相关知乎讨论 ↗</a>` : '';
  const source = candidate.sourceUrl ? '来自知乎 · ' : '';
  const profileParagraphs = (Array.isArray(candidate.profile) ? candidate.profile : [candidate.profile]).filter(Boolean).slice(0, 2);
  const profile = profileParagraphs.length ? `<div class="candidate-profile">${profileParagraphs.map(text => `<p>${esc(text)}</p>`).join('')}${candidate.focus ? `<section><span>最近最明显的一条线</span><p>${esc(candidate.focus)}</p></section>` : ''}</div>` : '';
  return `<div class="candidate-overlay-layer"><article class="candidate-overlay-card" role="dialog" aria-modal="true" aria-labelledby="candidate-name"><button class="back" data-action="back">← 回到刚才的聊天</button><div class="candidate-head">${avatar(candidate, 'candidate')}<div><p class="eyebrow">你选择继续看见的人</p><h1 id="candidate-name">${esc(candidate.name)}</h1><p>${esc(candidate.context)}</p></div></div><blockquote class="quote">“${esc(candidate.quote)}”</blockquote><p class="source">${source}${esc(candidate.time)}${publicSource}${referenceSource}</p>${profile}<div class="connection-copy"><p>${esc(candidate.shared)}</p></div><div class="actions">${candidate.contact ? `<button class="primary" data-action="write"${inactive}>回应 TA</button>` : ''}<button class="ghost" data-action="back"${inactive}>先不回应</button></div></article></div>`;
}

function consentOverlay(candidate) {
  if (candidate.publicReference) {
    return `<div class="candidate-overlay-layer mailbox-overlay-layer"><article class="mailbox-consent-card" role="dialog" aria-modal="true" aria-labelledby="mailbox-consent-title"><button class="back" data-action="back">← 回到原讨论</button><p class="mailbox-kicker">${mailboxIcon()}<span>看山们的信箱</span></p><h1 id="mailbox-consent-title">回到知乎回应之前，要不要也留下一张纸？</h1><div class="mailbox-consent-copy"><p>刚才那句话来自知乎的公开讨论。</p><p>如果愿意，你也可以留下关于“${esc(current().sharePaper.subject)}”的纸条，让信箱里的人看见。未来 7 天，看山也会把它带给相关的人；不会公开完整聊天，也可以随时收回。</p></div><button class="primary mailbox-confirm" data-action="confirm-consent">确认</button></article></div>`;
  }
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><article class="mailbox-consent-card" role="dialog" aria-modal="true" aria-labelledby="mailbox-consent-title"><button class="back" data-action="back">← 回到 ${esc(candidate.name)}</button><p class="mailbox-kicker">${mailboxIcon()}<span>看山们的信箱</span></p><h1 id="mailbox-consent-title">在去见 ${esc(candidate.name)} 之前，要不要也留下一张纸？</h1><div class="mailbox-consent-copy"><p>你能看见 ${esc(candidate.name)}，是因为他允许这句话在遇到相关的人时被带出来。</p><p>如果愿意，你也可以留下一张关于${esc(current().sharePaper.subject)}的纸。未来 7 天，它只会被带给真正相关的人；不会公开完整聊天，也可以随时收回。</p></div><button class="primary mailbox-confirm" data-action="confirm-consent">确认</button></article></div>`;
}

function sharePaperOverlay() {
  const user = current();
  const paper = user.sharePaper;
  const candidate = user.candidates[state.selected];
  const recipient = esc(candidate.name);
  const scope = candidate.publicReference ? '纸条可在信箱中浏览；未来 7 天，看山也会把它带给相关的人。不会共享完整聊天，可随时收回。' : '未来 7 天，只在具体关联成立时由对方的看山带回；不会共享完整聊天。';
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><article class="candidate-overlay-card share-paper-card" role="dialog" aria-modal="true" aria-labelledby="share-paper-name"><button class="back" data-action="back">← 返回授权说明</button><div class="candidate-head">${avatar(user, 'candidate')}<div><p class="eyebrow">准备投入看山们的信箱</p><h1 id="share-paper-name">${esc(user.name)}</h1><p>${esc(paper.context)}</p></div></div><blockquote class="quote">“${esc(paper.quote)}”</blockquote><p class="source">由看山根据刚才的对话整理</p><div class="candidate-profile"><p>${esc(paper.background)}</p></div><p class="mailbox-scope-line"><span>可发现范围</span>${scope}</p><div class="actions"><button class="primary" data-action="deposit">${candidate.publicReference ? '投入看山们的信箱' : `投入信箱，也递给 ${recipient}`}</button><button class="ghost" data-action="back">再看一遍授权说明</button></div></article></div>`;
}

function depositOverlay() {
  const user = current();
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit" role="status" aria-live="polite"><div class="mailbox-stage" aria-hidden="true"><div class="deposit-paper"><span>${esc(user.name.toUpperCase())}</span><i>${esc(user.sharePaper.subject)}</i></div><div class="shared-mailbox"><div class="mailbox-slot"></div><div class="mailbox-box"><span>看山们的信箱</span></div></div><img class="deposit-kanshan" src="/paper-assets/kanshan-letter.png" alt=""/></div><h1>正在把这张纸投入信箱……</h1><p>${user.candidates[state.selected].publicReference ? '把这份好奇留下，让相关的人有机会看见。' : `也在把它递给 ${esc(user.candidates[state.selected].name)}。`}</p></section></div>`;
}

function deliveredOverlay(candidate) {
  if (candidate.publicReference) {
    return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit mailbox-delivered" role="dialog" aria-modal="true" aria-labelledby="delivery-title">${mailboxIcon()}<h1 id="delivery-title">纸条已投入信箱。</h1><p>这份好奇可以被更多相关的人看见。<br/>现在，要不要回到知乎，把话接下去？</p><button class="primary" data-action="continue-public">回到知乎原文回应</button><button class="text-btn" data-action="finish-delivery">先不回应</button></section></div>`;
  }
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit mailbox-delivered" role="dialog" aria-modal="true" aria-labelledby="delivery-title">${mailboxIcon()}<h1 id="delivery-title">纸条已投入信箱，也已递给 ${esc(candidate.name)}。</h1><p>你可以停在这里，也可以再聊几句。</p><button class="primary" data-action="continue-private">继续和 ${esc(candidate.name)} 聊聊</button><button class="text-btn" data-action="finish-delivery">不聊了</button></section></div>`;
}

function privateChat(candidate) {
  const user = current();
  return `<main class="kanshan-scene zh-private-scene">${zhihuBackdrop()}<div class="zh-haze" aria-hidden="true"></div><div class="zh-private-shade" aria-hidden="true"></div>
    <section class="zh-private-window" role="dialog" aria-modal="true" aria-labelledby="private-title">
      <header class="zh-private-title"><h1 id="private-title">${esc(candidate.name)}</h1><button data-action="close-private" aria-label="关闭私信">×</button></header>
      <div class="zh-private-history" role="log" aria-label="与 ${esc(candidate.name)} 的聊天记录" aria-live="polite">
        <p class="zh-private-notice">纸条已递出，等待对方回应</p>
        <div class="zh-private-row"><article class="zh-private-paper"><span>来自看山们的信箱</span><h2>${esc(user.name)}</h2><small>${esc(user.sharePaper.context)}</small><blockquote>“${esc(user.sharePaper.quote)}”</blockquote><p>${esc(user.sharePaper.background)}</p></article>${avatar(user)}</div>
        ${state.privateMessages.map(message => `<div class="zh-private-row"><p class="zh-private-bubble">${esc(message)}</p>${avatar(user)}</div>`).join('')}
      </div>
      <div class="zh-private-composer">
        <div class="zh-private-tools" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14c2 3 6 3 8 0M8 9h.1M16 9h.1"/></svg><svg viewBox="0 0 24 24"><path d="M13 20H4V4h16v9M4 17l5-5 4 4 3-3M19 16v6M16 19h6"/><circle cx="9" cy="8" r="1.5"/></svg></div>
        <div class="zh-private-entry">
          <textarea id="private-message" aria-label="写下你想对 ${esc(candidate.name)} 说的话" aria-describedby="private-guidance" placeholder="想接着对 ${esc(candidate.name)} 说些什么？">${esc(state.privateDraft)}</textarea>
          <aside class="private-compose-hint" aria-label="写消息提示"><span class="private-hint-kanshan" role="img" aria-label="侧身指向前方的纸绘刘看山"></span><div class="private-hint-bubble" id="private-guidance"><strong>现在轮到你了。</strong><p>写一句只想让 ${esc(candidate.name)} 看见的话。他可以接受，也可以不回应。</p></div></aside>
        </div>
        <div class="zh-private-sendbar"><span>按 Enter 键发送</span><button data-action="send-private"${state.privateDraft.trim() ? '' : ' disabled'}>发送</button></div>
      </div>
    </section></main>`;
}

function publicDiscussion(candidate, preview = false) {
  const user = current();
  const source = candidate.publicReference;
  return `<main class="kanshan-scene zh-private-scene">${zhihuBackdrop()}<div class="zh-haze" aria-hidden="true"></div><div class="zh-private-shade" aria-hidden="true"></div>
    <section class="zh-private-window zh-public-window" role="dialog" aria-modal="true" aria-labelledby="public-title">
      <header class="zh-private-title"><h1 id="public-title">${preview ? '知乎里的这段讨论' : '回到知乎的这段讨论'}</h1><button data-action="close-public" aria-label="${preview ? '回到刚才的聊天' : '关闭讨论'}">×</button></header>
      <div class="zh-public-history" aria-label="知乎回答与评论片段">
        <article class="zh-public-answer"><div class="zh-public-source"><span>${esc(source.contentLabel)}</span><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.linkLabel)}</a></div><h2>${esc(source.title)}</h2><p>${esc(source.contextSummary)}</p><small>Demo 文章与评论 · 由知乎公开讨论改编</small></article>
        <section class="zh-public-comments" aria-label="评论区"><h3>评论 · 按互动排序</h3><p class="zh-public-visibility">${esc(source.visibilityNote)}</p><article class="zh-public-comment">${avatar(candidate)}<div><strong>${esc(candidate.name)}</strong><p>${esc(candidate.quote)}</p><span>${esc(candidate.time)}</span><div class="zh-public-actions" aria-label="这条评论的互动数据"><span><b>▲</b> 赞同 ${source.metrics.upvotes}</span><span>▼ 反对 ${source.metrics.downvotes}</span><span>回复 ${source.metrics.replies}</span></div></div></article>
          <div class="zh-public-replies" role="log" aria-live="polite">${state.publicReplies.map(message => `<article class="zh-public-comment">${avatar(user)}<div><strong>${esc(user.name)} <small>回复 ${esc(candidate.name)}</small></strong><p>${esc(message)}</p><span>刚刚 · 演示回应，仅当前页面可见</span></div></article>`).join('')}</div>
        </section>
      </div>
      ${preview ? `<div class="zh-public-preview-actions"><button data-action="write">回应这条表达</button><button data-action="close-public">回到刚才的聊天</button></div>` : `<div class="zh-private-composer zh-public-composer"><p class="zh-public-reply-label">回复 ${esc(candidate.name)}</p><div class="zh-private-entry">
        <textarea id="public-response" aria-label="回复 ${esc(candidate.name)} 的评论" aria-describedby="public-guidance" placeholder="把你的观察接在这条评论下面……">${esc(state.publicDraft)}</textarea>
        <aside class="private-compose-hint" aria-label="回应提示"><span class="private-hint-kanshan" role="img" aria-label="侧身指向前方的纸绘刘看山"></span><div class="private-hint-bubble" id="public-guidance"><strong>现在轮到你了。</strong><p>把你的观察留在这条评论下面，让 ${esc(candidate.name)}，也让路过的人看见。</p></div></aside>
      </div><div class="zh-private-sendbar"><span>Demo 评论预览 · Enter 发布</span><button data-action="send-public"${state.publicDraft.trim() ? '' : ' disabled'}>发布</button></div></div>`}
    </section></main>`;
}

function sendPublicResponse() {
  const field = document.querySelector('#public-response');
  const value = field.value.trim();
  if (!value) { field.focus(); return; }
  state.publicReplies.push(value);
  state.publicDraft = '';
  render();
  const history = document.querySelector('.zh-public-history');
  if (history) history.scrollTop = history.scrollHeight;
  document.querySelector('#public-response').focus();
}

function sendPrivateMessage() {
  const field = document.querySelector('#private-message');
  const value = field.value.trim();
  if (!value) { field.focus(); return; }
  state.privateMessages.push(value);
  state.privateDraft = '';
  render();
  const history = document.querySelector('.zh-private-history');
  if (history) history.scrollTop = history.scrollHeight;
  document.querySelector('#private-message').focus();
}

function playChat() {
  clearTimeout(state.timer); render();
  const body = document.querySelector('.kanshan-body');
  if (body) body.scrollTop = body.scrollHeight;
  const user = current();
  const sequence = [...user.chat, ...(user.discoveryChat || [])];
  if (state.screen === 'chat' && state.chatOpen && state.stage < sequence.length) {
    const nextMessage = sequence[state.stage];
    if (state.typewriterStage === state.stage) {
      const totalCharacters = messageLength(nextMessage);
      state.timer = setTimeout(() => {
        state.typedChars = Math.min(totalCharacters, state.typedChars + 6);
        if (state.typedChars >= totalCharacters) {
          state.stage += 1;
          state.typewriterStage = null;
          state.typedChars = 0;
        }
        playChat();
      }, 38);
      return;
    }
    const delay = state.stage === 0 ? 900 : (sequence[state.stage]?.delay || 1300);
    state.timer = setTimeout(() => {
      if (nextMessage.typewriter) {
        state.typewriterStage = state.stage;
        state.typedChars = 0;
      } else {
        state.stage += 1;
      }
      playChat();
    }, delay);
  }
}

function bind() {
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    if (button.disabled) return;
    const action = button.dataset.action;
    if (action === 'style') { state.avatarStyle = button.dataset.style; render(); }
    if (action === 'choose') { state.currentUser = button.dataset.id; state.screen = 'login'; render(); }
    if (action === 'enter-chat') { Object.assign(state, { screen: 'chat', stage: 0, chatOpen: true, typewriterStage: null, typedChars: 0 }); playChat(); }
    if (action === 'replay-chat') { Object.assign(state, { stage: 0, typewriterStage: null, typedChars: 0 }); playChat(); }
    if (action === 'collapse-chat' || action === 'toggle-chat') { clearTimeout(state.timer); state.chatOpen = action === 'collapse-chat' ? false : !state.chatOpen; if (state.chatOpen) playChat(); else render(); document.querySelector(state.chatOpen ? '[data-action="collapse-chat"]' : '.kanshan-launcher')?.focus(); }
    if (action === 'view' && !state.selected) { state.selected = button.dataset.id; state.screen = current().candidates[state.selected].publicReference ? 'public-preview' : 'card'; render(); }
    if (action === 'write' && !current().candidates[state.selected]?.previewOnly) { state.screen = 'consent'; render(); }
    if (action === 'confirm-consent') { state.screen = 'share'; render(); }
    if (action === 'deposit' && state.screen === 'share') { state.screen = 'deposit'; render(); clearTimeout(state.timer); state.timer = setTimeout(() => { state.timer = null; state.screen = 'delivered'; render(); }, 8400); }
    if (action === 'continue-private' && state.screen === 'delivered' && !current().candidates[state.selected].publicReference) { state.screen = 'private'; render(); document.querySelector('#private-message').focus(); }
    if (action === 'continue-public' && state.screen === 'delivered' && current().candidates[state.selected].publicReference) { state.screen = 'public'; render(); document.querySelector('#public-response').focus(); }
    if (action === 'close-public') { state.screen = state.screen === 'public-preview' ? 'chat' : 'delivered'; render(); const body = document.querySelector('.kanshan-body'); if (body) body.scrollTop = body.scrollHeight; }
    if (action === 'send-public' && state.screen === 'public') sendPublicResponse();
    if (action === 'close-private') { state.screen = 'delivered'; render(); }
    if (action === 'finish-delivery' && state.screen === 'delivered') { state.screen = 'chat'; state.chatOpen = true; render(); const body = document.querySelector('.kanshan-body'); if (body) body.scrollTop = body.scrollHeight; }
    if (action === 'send-private' && state.screen === 'private') sendPrivateMessage();
    if (action === 'back-home') { clearTimeout(state.timer); Object.assign(state, { screen: 'home', currentUser: null, stage: 0, selected: null, privateDraft: '', privateMessages: [], publicDraft: '', publicReplies: [], timer: null, chatOpen: true, typewriterStage: null, typedChars: 0 }); render(); }
    if (action === 'back') { clearTimeout(state.timer); if (state.screen === 'card' && current().candidates[state.selected]?.previewOnly) state.selected = null; if (state.screen === 'consent') state.screen = current().candidates[state.selected].publicReference ? 'public-preview' : 'card'; else if (state.screen === 'share') state.screen = 'consent'; else state.screen = 'chat'; render(); if (state.screen === 'chat') { const body = document.querySelector('.kanshan-body'); if (body) body.scrollTop = body.scrollHeight; } }
    if (action === 'reset') { clearTimeout(state.timer); Object.assign(state, { screen: 'home', currentUser: null, stage: 0, selected: null, privateDraft: '', privateMessages: [], publicDraft: '', publicReplies: [], timer: null, typewriterStage: null, typedChars: 0 }); render(); }
  }));
  if (state.screen === 'public') {
    const field = document.querySelector('#public-response');
    field.addEventListener('input', () => { state.publicDraft = field.value; document.querySelector('[data-action="send-public"]').disabled = !field.value.trim(); });
    field.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendPublicResponse(); } });
  }
  if (state.screen === 'private') {
    const field = document.querySelector('#private-message');
    field.addEventListener('input', () => { state.privateDraft = field.value; document.querySelector('[data-action="send-private"]').disabled = !field.value.trim(); });
    field.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendPrivateMessage(); } });
  }
}

render();
