import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const building = new URL('../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('开发相关文档/Demo冻结_20260915.sha256.json', building), 'utf8'));
for (const [path, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(`qiaomen/${path}`, building));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Frozen Demo changed: ${path}`);
}
console.log(`Frozen Demo verified: ${Object.keys(manifest.files).length} files unchanged.`);
