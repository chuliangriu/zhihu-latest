// Extract only assets used by the approved homepage. Never execute its script.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const source = new URL('../test-fixtures/前端设计/未见之人_纸绘首页 (1).html', import.meta.url);
const html = await readFile(source, 'utf8');
const assets = JSON.parse(html.match(/const previewAssets=(\{.*?\});/s)[1]);
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const embedded = [
  ['kanshan.png', assets['/avatars/liukanshan-muted.png']],
  ['paper-sans.woff', css.match(/src: url\('(data:[^']+)'\)/)[1]],
  ['grain.svg', css.match(/background: url\('(data:[^']+)'\)/)[1]],
];
const out = new URL('../public/paper-assets/', import.meta.url);
await mkdir(out, { recursive: true });
for (const [name, data] of embedded) {
  if (!data.includes(';base64,')) throw new Error(`Unexpected encoding: ${name}`);
  await writeFile(new URL(name, out), Buffer.from(data.split(',')[1], 'base64'));
  console.log(`Extracted ${name}`);
}
