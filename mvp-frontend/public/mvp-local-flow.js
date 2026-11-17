import { PRIVATE_MAILBOX_FIXTURES } from './mvp-samples.js';

// Frontend interaction fixture, not the production matcher or a model output.
// Only a narrow, explicit creative-work/no-feedback input activates these
// fixtures. Other input keeps the chat intact until the real service is wired.
export function localChatTurn(text) {
  const creative = /小说|故事|写作|创作|插画|画画|录音|写/.test(text);
  const noEcho = /没人|没有人|回应|反馈|回声|意义|价值|放不下|继续/.test(text);
  if (!creative || !noEcho) return { messages: [{ role: 'user', text }], discovery: [], candidates: {} };
  const [first, second] = PRIVATE_MAILBOX_FIXTURES;
  const makeCandidate = (sample, name, avatarKey, previewOnly) => ({
    name, avatarKey, context: sample.context, time: sample.time, quote: sample.quote,
    profile: sample.quote, focus: sample.concern, shared: sample.concern,
    synthetic: true, contact: true, previewOnly,
  });
  return {
    messages: [
      { role: 'user', text },
      { role: 'agent', paragraphs: ['没有回应，确实会让人很难判断下一步。', '你还愿不愿意继续，和它现在有没有被看见，可以先分开想想。'] },
    ],
    candidates: {
      A: makeCandidate(first, '一个还在记录的人', 'theo', true),
      B: makeCandidate(second, '一个习惯补上空缺的人', 'mika', false),
    },
    discovery: [
      { role: 'agent', discovery: 'start', delay: 2000, blocks: [
        { type: 'text', text: '还有一件事儿。说到一直没有回声，我想起了信箱里的两张纸。' },
        { type: 'lead', text: '有些投入，也还在等待一个回应。' },
      ] },
      { role: 'agent', discovery: 'continue', delay: 2200, typewriter: true, blocks: [
        { type: 'choice', text: '选择一' },
        { type: 'text', text: '我想起了一个也在持续记录的人。和你一样，他也在创作，也会想：这些东西是不是只有自己觉得值得留下。' },
        { type: 'time', text: `${first.time} · 非真人` },
        { type: 'quote', text: first.quote },
      ] },
      { role: 'agent', discovery: 'focus', delay: 2700, typewriter: true, blocks: [
        { type: 'choice', text: '选择二' },
        { type: 'turn', text: '只是我又想到一个人。' },
        { type: 'text', text: '他没有在做创作，却也会在付出之后，拿不准这些事情有没有帮上忙。' },
        { type: 'time', text: `${second.time} · 非真人` },
        { type: 'quote', text: second.quote },
        { type: 'text', text: '你们经历的事不同，却都在等待一个能判断下一步的回声。' },
      ] },
    ],
  };
}
