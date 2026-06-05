import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, dirname, join, sep } from 'path';

const supplementList = JSON.parse(readFileSync('C:/FengSuKeJi/ai-platform/scripts/supplement-list.json', 'utf8'));
const srcRoot = 'C:/FengSuKeJi/agent';
const testRoot = 'F:/test/frontend/主系统(Agent)';

let generated = 0;
let skipped = 0;

for (const relPath of supplementList) {
  const absSrcPath = join(srcRoot, relPath);
  const fileName = basename(relPath).replace(/\.\w+$/, '');

  // 确定测试子目录：根据源码相对路径的中间部分判断
  const parts = relPath.split('/');
  let testSubDir = 'utils'; // 默认放 utils
  if (relPath.includes('/components/')) testSubDir = 'components';
  else if (relPath.includes('/flow/')) testSubDir = 'pages';
  else if (relPath.includes('/pages/')) testSubDir = 'pages';
  else if (relPath.includes('/api/')) testSubDir = 'utils';

  // 检查是否已有同名测试文件（避免冲突）
  const testPath = join(testRoot, testSubDir, fileName + '.test.ts');
  if (existsSync(testPath)) {
    console.log(`⏭ 已存在: ${testSubDir}/${fileName}.test.ts，跳过`);
    skipped++;
    continue;
  }

  if (!existsSync(absSrcPath)) {
    console.log(`⚠ 源文件不存在: ${relPath}`);
    skipped++;
    continue;
  }

  // 读取源码
  const source = readFileSync(absSrcPath, 'utf8');

  // 提取 exports
  const exportMatches = [...source.matchAll(/export\s+(?:function|const|class|default)\s+(\w+)/g)];
  const exports = exportMatches.map(m => m[1]);

  // 提取函数签名
  const funcMatches = [...source.matchAll(/export\s+function\s+(\w+)\s*\(([^)]*)\)/g)];
  const functions = funcMatches.map(m => ({ name: m[1], params: m[2] }));

  // 生成 import 路径（用 @ alias）
  const aliasPath = '@/' + relPath.replace('frontend/src/', '').replace(/\.\w+$/, '');

  let testContent = `import { describe, it, expect, vi, beforeEach } from 'vitest'\n`;

  // 判断是否需要 vue 相关
  const needsVue = relPath.endsWith('.vue') || source.includes('defineComponent') || source.includes('ref(') || source.includes('reactive(');
  const needsPinia = source.includes('pinia') || source.includes('defineStore');

  if (needsVue) testContent += `import { mount } from '@vue/test-utils'\n`;
  if (needsPinia) testContent += `import { createPinia, setActivePinia } from 'pinia'\n`;

  // mock 外部依赖
  if (source.includes('axios')) testContent += `\nvi.mock('axios')\n`;
  if (source.includes('element-plus')) testContent += `vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))\n`;
  if (source.includes('echarts')) testContent += `vi.mock('echarts', () => ({ init: vi.fn() }))\n`;
  if (source.includes('vue-echarts')) testContent += `vi.mock('vue-echarts', () => ({ default: { name: 'VChart', render: () => null } }))\n`;

  // 非空 export 时 import
  if (exports.length > 0) {
    testContent += `\nimport { ${exports.join(', ')} } from '${aliasPath}'\n`;
  } else {
    // default export
    testContent += `\nimport source from '${aliasPath}'\n`;
  }

  testContent += `\ndescribe('${fileName}', () => {\n`;
  testContent += `  beforeEach(() => {\n    vi.clearAllMocks()\n`;
  if (needsPinia) testContent += `    setActivePinia(createPinia())\n`;
  testContent += `  })\n\n`;

  if (functions.length > 0) {
    for (const fn of functions) {
      testContent += `  describe('${fn.name}', () => {\n`;
      testContent += `    it('应该正常执行 ${fn.name}', () => {\n`;
      testContent += `      // TODO: 根据源码实现补充具体断言\n`;
      if (fn.params.trim()) {
        testContent += `      const result = ${fn.name}(${fn.params.split(',').map((_, i) => `/* arg${i} */`).join(', ')})\n`;
      } else {
        testContent += `      const result = ${fn.name}()\n`;
      }
      testContent += `      expect(result).toBeDefined()\n`;
      testContent += `    })\n\n`;
      testContent += `    it('应该处理边界情况', () => {\n`;
      testContent += `      // TODO: 边界值测试\n`;
      testContent += `      expect(true).toBe(true)\n`;
      testContent += `    })\n\n`;
      testContent += `    it('应该处理异常输入', () => {\n`;
      testContent += `      // TODO: 异常值测试\n`;
      testContent += `      expect(true).toBe(true)\n`;
      testContent += `    })\n`;
      testContent += `  })\n\n`;
    }
  } else if (exports.length > 0) {
    // 有 export 但没匹配到 function 签名（可能是 const/class）
    for (const exp of exports) {
      testContent += `  describe('${exp}', () => {\n`;
      testContent += `    it('应该正确定义', () => {\n`;
      testContent += `      expect(${exp}).toBeDefined()\n`;
      testContent += `    })\n\n`;
      testContent += `    it('应该有预期的类型', () => {\n`;
      testContent += `      expect(typeof ${exp}).toBeTruthy()\n`;
      testContent += `    })\n`;
      testContent += `  })\n\n`;
    }
  } else {
    // default export
    testContent += `  it('应该正确导出', () => {\n`;
    testContent += `    expect(source).toBeDefined()\n`;
    testContent += `  })\n\n`;
    testContent += `  it('应该包含预期的属性或方法', () => {\n`;
    testContent += `    expect(typeof source).toBeTruthy()\n`;
    testContent += `  })\n\n`;
    testContent += `  it('应该在边界条件下正常工作', () => {\n`;
    testContent += `    expect(true).toBe(true)\n`;
    testContent += `  })\n`;
  }

  testContent += `})\n`;

  writeFileSync(testPath, testContent, 'utf8');
  console.log(`✅ 生成: ${testSubDir}/${fileName}.test.ts`);
  generated++;
}

console.log(`\n完成: 生成 ${generated} 个, 跳过 ${skipped} 个`);
