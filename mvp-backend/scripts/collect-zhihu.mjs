// Offline corpus collector. Uses the official CLI/keychain, never prints credentials or response bodies.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
const exec = promisify(execFile);
const path = new URL('../data/zhihu-public-corpus.json', import.meta.url);
const corpus = JSON.parse(await readFile(path, 'utf8'));
if (corpus.status === 'partial_rate_limited' && !process.argv.includes('--resume-after-rate-limit')) {
  throw new Error('Previous collection was rate limited. Resume explicitly only after the service limit resets.');
}
const cli = process.env.ZHIHU_CLI_PATH;
if (!cli || !cli.startsWith('/') || /[\r\n]/.test(cli)) throw new Error('Set ZHIHU_CLI_PATH to the official CLI absolute path returned by Skill status');
const queries = [
  ['space', '客厅 家人 各自 房间 意义'], ['reading', '读者 为什么 不愿意 读下去'],
  ['friendship', '主动联系朋友 对方 不主动'], ['hobby', '坚持爱好 没有人理解'],
  ['study', '努力学习 成绩 没有进步'], ['team', '团队 社团 付出 不被看见'],
  ['family', '家务 付出 被当作理所当然'], ['city', '陌生城市 没有归属感'],
  ['creative', '画画 没人看 坚持'], ['career', '毕业 工作 不知道 喜欢什么'],
  ['community', '组织活动 没有人参加'], ['music', '学乐器 练琴 没有进步'],
  ['research', '科研 没有进展 坚持'], ['sport', '跑步 坚持 没有变化'],
  ['reading', '读书 没有人可以交流'], ['family', '离开家 工作 思念家乡']
];
const seen = new Set(corpus.records.map(r => r.url.split('?')[0]));
for (const [domain, query] of queries) {
  if (corpus.records.length >= 100) break;
  if (corpus.queries.some(q => q.query === query)) continue;
  try {
    const { stdout } = await exec(cli, ['search', 'zhihu', '--query', query, '--count', '10', '--timeout', '20s'],
      { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (result.Code !== 0) {
      corpus.status = [30001, 30002].includes(result.Code) ? 'partial_rate_limited' : 'partial_service_error';
      corpus.lastErrorCode = Number(result.Code); break;
    }
    if (!Array.isArray(result.Data?.Items)) throw new Error('Invalid response');
    const retrievedAt = new Date().toISOString();
    for (const item of result.Data.Items) {
      if (corpus.records.length >= 100) break;
      if (!['Answer','Question'].includes(item.ContentType) || !item.ContentText || !item.Url) continue;
      const url = new URL(item.Url);
      if (url.protocol !== 'https:' || !['www.zhihu.com','zhihu.com'].includes(url.hostname)) continue;
      const key = item.Url.split('?')[0]; if (seen.has(key)) continue;
      seen.add(key);
      const index = corpus.records.length;
      corpus.records.push({ id: `zh-${index+1}`, domain, query, retrievedAt, title: item.Title,
        contentType: item.ContentType.toLowerCase(), text: item.ContentText, url: item.Url,
        authorName: item.AuthorName, authorKey: item.AuthorSignature || item.AuthorName,
        editTime: item.EditTime ?? null, voteUpCount: item.VoteUpCount ?? null, commentCount: item.CommentCount ?? null,
        usage: index % 2 === 0 ? 'public_candidate' : 'adaptation_reference' });
    }
    corpus.queries.push({ domain, query, count: result.Data.Items.length });
    corpus.collected = corpus.records.length;
    corpus.status = corpus.collected >= 100 ? 'complete' : 'partial';
    await writeFile(path, JSON.stringify(corpus, null, 2) + '\n');
    console.info(JSON.stringify({ collected: corpus.collected, target: 100 }));
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch {
    // CLI can report rate limits with non-zero exit status too; never blindly retry.
    corpus.status = 'partial_service_error'; break;
  }
}
corpus.collected = corpus.records.length;
await writeFile(path, JSON.stringify(corpus, null, 2) + '\n');
console.info(JSON.stringify({ collected: corpus.collected, status: corpus.status, remaining: Math.max(0,100-corpus.collected) }));
if (corpus.collected < 100) process.exitCode = 2;
