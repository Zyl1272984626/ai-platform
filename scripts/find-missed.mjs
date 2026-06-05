import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const disc = JSON.parse(readFileSync('C:/FengSuKeJi/ai-platform/server/data/projects/agent-main/frontend-discovery.json', 'utf8'));
const discovered = new Set();
disc.modules.forEach(m => m.files.forEach(f => discovered.add(f.path)));
console.log('已发现:', discovered.size, '个文件');

const vueFiles = execSync('find C:/FengSuKeJi/agent/frontend/src -name "*.vue"', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const jsFiles = execSync('find C:/FengSuKeJi/agent/frontend/src \\( -name "*.js" -o -name "*.ts" \\) ! -name "*.d.ts"', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const allFiles = [...vueFiles, ...jsFiles];
console.log('源码总量:', allFiles.length);

const toRel = p => p.replace(/\\/g, '/').replace('C:/FengSuKeJi/agent/', '');
const missed = allFiles.map(toRel).filter(p => !discovered.has(p));
console.log('未收录:', missed.length);

const skip = p =>
  p.includes('svg-') ||
  p.includes('iconfont') ||
  p.includes('/router/') ||
  p.endsWith('/main.js') || p.endsWith('/main.ts') ||
  p.endsWith('.d.ts') ||
  p.includes('/test/') || p.includes('/tests/') ||
  p.includes('/__tests__/');

const candidates = missed.filter(p => !skip(p));
console.log('过滤后候选:', candidates.length);

writeFileSync('C:/FengSuKeJi/ai-platform/scripts/missed-files.json', JSON.stringify(candidates, null, 2));
candidates.forEach(p => console.log(p));
