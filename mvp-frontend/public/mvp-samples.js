// Frontend-only cold-start fixtures. They are not people, accounts, public
// Zhihu posts, authorized records or contactable recipients.
export const PRIVATE_MAILBOX_FIXTURES = [
  { id: 'fixture-night-radio', sourceType: 'synthetic_private_sample', synthetic: true, time: '2 天前', context: '下班后做声音记录', quote: '我录了很久城市夜里的声音。没人问起时，我也会怀疑，这些细小的东西是不是只有我觉得值得留下。', concern: '持续保存一件暂时没有回声、却仍舍不得放下的事。' },
  { id: 'fixture-club-notes', sourceType: 'synthetic_private_sample', synthetic: true, time: '3 天前', context: '刚开始工作的组织者', quote: '我习惯把没人接住的事情补完。事情顺利过去以后，大家都往前走了，我却不知道那些付出到底有没有帮上忙。', concern: '在沉默里等待一个能判断下一步的回声。' },
  { id: 'fixture-family-recipes', sourceType: 'synthetic_private_sample', synthetic: true, time: '4 天前', context: '正在整理家庭旧物', quote: '我开始把家里那些只凭手感做的菜写下来。长辈觉得没必要，可我总怕再晚一点，就没有人记得原来的味道了。', concern: '想把正在消失的经验留下，却不能确定它会不会抵达别人。' },
  { id: 'fixture-reading-room', sourceType: 'synthetic_private_sample', synthetic: true, time: '5 天前', context: '发起小型读书活动', quote: '我每周都把桌椅摆好，有时最后只来了一个人。我还是会继续准备，只是不知道怎样才能让这里真的成为大家愿意留下的地方。', concern: '为一件共同发生的事留出空间，也承受它可能无人到来的不确定。' },
  { id: 'fixture-long-practice', sourceType: 'synthetic_private_sample', synthetic: true, time: '6 天前', context: '重新开始练琴', quote: '我练的曲子没有打算发给谁。可如果连续几天没碰琴，我会觉得生活里有一块东西正在慢慢退回去。', concern: '没有外部评价时，仍在辨认一件事对自己为何重要。' },
  { id: 'fixture-team-prototype', sourceType: 'synthetic_private_sample', synthetic: true, time: '6 天前', context: '在团队里做小工具', quote: '我做了一个能省下很多重复步骤的小工具，发出去以后一直很安静。我不知道是大家不需要，还是它只是还没被真正用起来。', concern: '作品交出去以后，缺少足以修正方向的具体反馈。' },
];
