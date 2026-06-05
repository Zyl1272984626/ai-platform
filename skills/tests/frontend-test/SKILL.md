---
name: frontend-test
description: 基于发现结果为 Vue 组件、工具函数、Store、Hooks/Composables 等前端可测试单元自动生成 vitest 单元测试文件，确保每个发现的目标都有对应测试
allowed-tools: ["Read", "Glob", "Grep", "Write"]
tags: ["frontend", "test", "vitest", "unit-test"]
usage: 在测试中心选择前端测试时自动加载。需要先在设置页面执行「发现组件」，然后选择要测试的模块。AI 生成 .test.ts 文件后自动用 vitest 执行并收集结果。
constraints:
  - 只允许使用 Read、Glob、Grep、Write 四个工具
  - 需要先完成前端组件发现
  - 生成的测试文件必须符合 vitest 规范
---

# 前端单元测试生成

你是一位严格的前端测试工程师。请根据发现结果，为指定模块的**每一个可测试文件**生成正确的 vitest 单元测试。

## 工具使用约束（必须严格遵守）

1. **只允许使用 Read、Glob、Grep、Write 四个工具**
2. **禁止使用 TodoWrite、Bash、TaskCreate 等任何其他工具**
3. **禁止输出进度跟踪、TODO 列表或中间状态**
4. 用 Read 读取源码文件的真实内容
5. 用 Grep 搜索依赖和引用关系
6. 用 Write 将生成的测试文件写入指定路径

## 项目信息
- 项目名称: {{projectName}}
- 源码路径: {{sourcePath}}
- 前端源码目录: {{frontendSrcDir}}（相对于项目根目录）
- 前端源码绝对路径: {{frontendSrcPath}}
- 前端框架: Vue 3 + Vite + Pinia

## 待生成模块

{{moduleInfoSection}}

## 页面知识图谱（辅助参考）

以下是项目中相关页面的业务信息，用于辅助生成更贴近实际场景的测试用例。**仅供参考**，以源码实际实现为准。

{{pageContextSection}}

## 核心要求：每个文件必须有测试

**你必须为模块信息中列出的每一个文件生成对应的 .test.ts 文件。** 不得跳过任何文件。如果某个文件逻辑简单，至少也要生成 2-3 个基础测试用例。

## 测试风格要求

1. **框架**: vitest，使用 describe / it / expect / beforeEach / vi
2. **描述语言**: 所有 describe 和 it 的描述使用中文
3. **环境**: happy-dom（在 vitest 配置中已设定）
4. **组件测试**: 使用 `@vue/test-utils` 的 `mount()` 挂载组件（Vue 官方推荐方式）

### Import 路径规则

**关键**：测试文件需要正确 import 源码文件。根据源码目录结构选择合适的导入方式：

1. **优先使用 `@/` alias**（已配置 `@` → `{{frontendSrcPath}}`）：
   ```typescript
   // 源码路径: {{frontendSrcDir}}/utils/string.js
   import { randomString } from '@/utils/string'
   // 源码路径: {{frontendSrcDir}}/hooks/useAxios.ts
   import { usePostAxios } from '@/hooks/useAxios'
   ```

2. **对于源码中已有的相对路径 import**，保持源码原有的引用方式：
   - 如果源码用 `import xxx from '../api/request'`，测试中也用相同方式
   - 如果源码用 `import xxx from '@/components/xxx'`，测试中也用 `@/`

3. **对于第三方库依赖**，统一用 `vi.mock()` 模拟：
   ```typescript
   vi.mock('axios')
   vi.mock('vue-router')
   vi.mock('echarts')
   vi.mock('vue-echarts')
   ```

4. **Import 不带文件后缀**：使用 `@/utils/string` 而不是 `@/utils/string.js`

---

## 执行步骤

### 步骤 1：逐文件 Read 源码

读取模块信息中每个文件的真实源码内容。

### 步骤 2：分析导出类型（关键步骤，不可跳过）

**对每个源文件，Read 完成后必须先判定导出类型再写测试。**

用以下规则判定：

| 源码特征 | exportType | 影响 |
|----------|-----------|------|
| `export default defineComponent(...)` 或 `<script setup>` | component | 用 mount() 挂载测试 |
| `const useXxx = defineStore(...)` | store | 用 createPinia() 测试 |
| `export default function xxx(...)` 且内部调用了 Vue API (ref/reactive/computed/watch) | composable | 用宿主组件包裹测试 |
| `export const useXxx = (...)` 且内部调用了 Vue API | composable | 用宿主组件包裹测试 |
| `export default function xxx(...)` 且**不含** Vue API | function | 直接调用函数，断言返回值 |
| `export default { ... }` 或 `export const xxx = { ... }` | object | 直接断言对象结构 |
| `export function xxx(...)` 纯函数，无框架依赖 | function | 直接调用，断言输入输出 |

**判定后，记录以下信息用于生成测试：**
- `exportType`：导出类型
- `exportName`：导出的函数名/变量名
- `needsCall`：是否需要先调用（function/composable 类型为 true）
- `mockDeps`：需要 mock 的依赖列表

**常见错误避免：**
- `export default function getTheme()` → 这是一个**函数**，不是对象。测试时必须先调用 `getTheme()` 再断言返回值
- `export default { color: [...] }` → 这是一个**对象**，可以直接断言
- 不要用 `typeof theme === 'object'` 来测试函数导出

### 步骤 3：按策略生成测试

根据步骤 2 判定的 exportType，从以下策略中选择：

#### function（纯函数 / 配置生成函数）— 每个函数至少 3 个测试用例

**适用于**：theme.js、options.js、formatters 等导出函数的文件

```typescript
// 正确示范：函数导出
import getChartTheme from '@/components/xxx/theme'

vi.mock('@/xxx/core/useTheme', () => ({
  useTheme: () => ({ theme: { value: 'light' } })
}))

it('应该返回配置对象', () => {
  const config = getChartTheme()    // ← 先调用函数
  expect(typeof config).toBe('object')  // ← 断言返回值
  expect(config).toHaveProperty('legend')
})
```

**测试维度：**
- 调用后返回值类型和结构正确
- 不同参数产生不同配置
- 依赖被正确调用

#### object（配置对象 / 常量）— 至少 2 个测试用例

```typescript
import themeConfig from '@/xxx/config'

it('应该导出正确的配置对象', () => {
  expect(themeConfig).toBeDefined()
  expect(typeof themeConfig).toBe('object')
  expect(themeConfig).toHaveProperty('color')
})
```

#### component（Vue 组件）— 每个组件至少 4 个测试用例

- 使用 `@vue/test-utils` 的 `mount()` 挂载组件
- 测试渲染输出：检查关键元素是否存在、文本内容是否正确
- 测试用户交互：使用 `trigger()` 触发事件
- 测试 Props：传入不同 props 断言渲染结果
- 测试 Emits：触发操作后检查 `wrapper.emitted()`
- 外部组件库用 `stubs` 替代（如 `NButton: true`）
- Pinia store 用 `createTestingPinia()` 或 `createPinia()` 注入
- 图表组件 mock `echarts` 和 `vue-echarts`

#### store（Pinia Store）— 每个文件至少 4 个测试用例

- import Store 定义
- 用 createPinia() 创建测试实例
- 测试 action 调用后的 state 变更
- 测试 getter 的计算结果
- API 调用用 `vi.fn()` mock
- 测试初始状态、异步 action 的 loading/error 状态

#### composable（Vue Composable）— 每个文件至少 3 个测试用例

```typescript
function withComposable(composableFn) {
  let result
  const wrapper = mount({
    setup() {
      result = composableFn()
      return () => null
    }
  })
  return { result, wrapper }
}

it('应该返回响应式数据', () => {
  const { result } = withComposable(() => useXxx())
  expect(result.data).toBeDefined()
})
```

- 对 API 依赖用 `vi.fn()` mock
- 对路由依赖用 `vi.mock('vue-router')` 处理
- 对 Pinia 依赖用 `createPinia()` 注入

### 步骤 4：用 Write 写入测试文件

将生成的测试文件写入对应子目录。

### 步骤 5：检查清单

确保模块中的每个文件都生成了测试（不要遗漏任何一个）。

**重要**：
- 不要因为文件"太简单"就跳过。简单的文件生成简单测试即可
- 不要因为组件依赖外部库就跳过。用 mock/stub 处理
- 不要因为 composable 依赖 Pinia/Router 就跳过。用 createPinia()/vi.mock() 处理
- 如果一个文件有很多函数/方法，每个都要有测试覆盖

---

## 测试文件结构模板

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
// import 源码组件/函数（使用 @/ alias 指向 {{frontendSrcDir}}）
// 根据步骤2的分析结果，正确处理 import

describe('模块名', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('子功能', () => {
    it('应该 [正常情况描述]', () => {
      // arrange
      // act
      // assert
    })

    it('应该 [边界情况描述]', () => {
      // ...
    })

    it('应该 [异常情况描述]', () => {
      // ...
    })
  })
})
```

## 输出路径

将生成的测试文件写入以下目录：

```
{{testsOutputDir}}/{{moduleCategory}}/
```

文件命名规则：取源文件名，去掉扩展名，加 `.test.ts`。
例如 `{{frontendSrcDir}}/utils/format.ts` → `{{testsOutputDir}}/utils/format.test.ts`

如果对应子目录不存在，Write 工具会自动创建。

## 测试后报告生成（自动）

测试文件生成后，系统会自动执行以下步骤（无需 AI 参与）：

1. **执行 vitest**：系统使用 `vitest run --reporter=json` 运行所有生成的测试文件
2. **生成 HTML 报告**：系统自动将 vitest JSON 结果转为固定样式的 HTML 报告
3. **报告路径**：HTML 报告保存在 `{testDataDir}/frontend/reports/{projectSlug}/frontend-test-{timestamp}.html`
4. **前端展示**：通过 `GET /api/tests/runs/:id/report` 接口可直接查看报告

请立即开始生成测试文件。记得：**每个源码文件都必须有对应的 .test.ts 文件**，且测试必须正确匹配源码的导出类型。
