import { readFileSync, writeFileSync } from 'fs';

const candidates = JSON.parse(readFileSync('C:/FengSuKeJi/ai-platform/scripts/missed-files.json', 'utf8'));

// 分成 JS/TS 和 Vue 两类
const jsFiles = candidates.filter(p => p.endsWith('.js') || p.endsWith('.ts'));
const vueFiles = candidates.filter(p => p.endsWith('.vue'));

// JS/TS: 有 export 的才有价值
// 排除纯 index.js (只做聚合导出)、install.js、permission.js
const skipPatterns = [
  /\/index\.js$/, /\/install\.js$/, /\/permission\.js$/,
  /\/global\.js$/, /\/eventBus\.js$/,
];

const valuableJs = jsFiles.filter(p => {
  // 跳过纯聚合/注册文件
  if (skipPatterns.some(pat => pat.test(p))) return false;
  // theme 文件只是配色常量
  if (p.includes('/theme/') && (p.endsWith('Dark.js') || p.endsWith('Light.js') || p.endsWith('index.js'))) return false;
  // meta.js 只是节点元数据定义
  if (p.endsWith('/meta.js')) return false;
  // config.js 在 flow 节点下是配置常量
  if (p.includes('/flow/components/nodes/') && p.endsWith('/config.js')) return false;
  // constant.js 安全常量
  if (p.endsWith('/constant.js')) return false;
  // bar.js/gauge.js/line.js 等是 Documentation 组件的渲染配置
  if (p.includes('/Documentation/') && p.endsWith('.js')) return false;
  // PresetDownload.config.js / PresetLink.config.js 是组件配置
  if (p.includes('/preset/') && (p.endsWith('.config.js') || p.endsWith('.meta.js'))) return false;
  // stores 占位（空实现）
  if (p.includes('messageConfigStore.js') || p.includes('messagePageStore.js')) return false;
  // logger（纯 console.log 封装）
  if (p.endsWith('/logger.js')) return false;
  // aceConfig（纯配置）
  if (p.endsWith('/aceConfig.js')) return false;
  // IconComponents（纯图标映射）
  if (p.endsWith('/IconComponents.js')) return false;
  // data.js 在 flow 节点下
  if (p.includes('/flow/') && p.endsWith('/data.js')) return false;
  return true;
});

console.log('有价值的 JS/TS 文件 (', valuableJs.length, '个):');
valuableJs.forEach(p => console.log('  ' + p));

writeFileSync('C:/FengSuKeJi/ai-platform/scripts/valuable-missed.json', JSON.stringify(valuableJs, null, 2));
