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

你是一位严格的前端测试工程师。请根据发现结果，为指定模块的**每一个可测试文件**生成完整的 vitest 单元测试。

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

### 按类别生成策略

#### utils（工具函数）— 每个函数至少 3 个测试用例
- 直接 import 源码函数（使用 `@/` alias）
- 给定输入，断言输出
- 覆盖正常值、边界值、异常值
- 每个函数至少 3 个测试用例（正常/边界/异常）
- 示例：
  ```typescript
  describe('randomString', () => {
    it('应该生成指定长度的随机字符串', () => { ... })
    it('应该生成随机长度范围内的字符串', () => { ... })
    it('应该处理无效输入（负数、零）', () => { ... })
  })
  ```

#### components（Vue 组件）— 每个组件至少 4 个测试用例
- 使用 `@vue/test-utils` 的 `mount()` 挂载组件
- 测试渲染输出：检查关键元素是否存在、文本内容是否正确
- 测试用户交互：使用 `trigger()` 触发事件，断言组件状态或 DOM 变化
- 测试 Props：传入不同 props 断言渲染结果
- 测试 Emits：触发操作后检查 `wrapper.emitted()` 是否包含预期事件
- 对外部组件库（Element Plus、Naive UI、Ant Design Vue 等）的引用，用 `stubs` 替代（如 `NButton: true`、`ElButton: true`）
- Pinia store 用 `createTestingPinia()` 或 `createPinia()` 注入
- **对于图表组件（ECharts）**：mock `echarts` 和 `vue-echarts`，测试配置生成逻辑
- **对于表单组件**：测试表单验证规则、数据绑定、提交事件

#### stores（Pinia Store）— 每个文件至少 4 个测试用例
- import Store 定义
- 用 createPinia() 创建测试实例
- 测试 action 调用后的 state 变更
- 测试 getter 的计算结果
- 对 API 调用用 `vi.fn()` mock
- 测试初始状态是否正确
- 测试异步 action 的 loading/error 状态

#### pages（hooks/composables）— 每个文件至少 3 个测试用例
- 这是**业务逻辑最集中**的类别，务必认真对待
- 对于纯逻辑函数（如 `mergeCurrentMessage`、`parseReasoningContent`）：直接测试输入输出
- 对于 Vue composables（以 `use` 开头的）：
  - 用 `mount` 一个测试宿主组件来测试 composable
  - 或者直接在 `setup` 函数中调用 composable
  ```typescript
  import { withSetup } from './test-utils' // 如果有
  // 或者手动包装
  let result: ReturnType<typeof useXxx>
  const wrapper = mount({
    setup() {
      result = useXxx()
      return () => null
    }
  })
  ```
- 对 API 依赖用 `vi.fn()` mock
- 对路由依赖用 `vi.mock('vue-router')` 处理
- 对 Pinia 依赖用 `createPinia()` 注入

### 测试文件结构模板

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
// import 源码组件/函数（使用 @/ alias 指向 {{frontendSrcDir}}）

describe('模块名', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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

## 执行步骤

1. **逐文件 Read 源码**：读取模块信息中每个文件的真实源码内容
2. **分析可测试逻辑**：识别函数、computed、watch、事件处理、action 等
3. **生成 .test.ts 文件**：为每个源码文件生成对应的测试文件
4. **用 Write 写入**对应子目录
5. **检查清单**：确保模块中的每个文件都生成了测试（不要遗漏任何一个）

**重要**：
- 不要因为文件"太简单"就跳过。简单的文件生成简单测试即可
- 不要因为组件依赖外部库就跳过。用 mock/stub 处理
- 不要因为 composable 依赖 Pinia/Router 就跳过。用 createPinia()/vi.mock() 处理
- 如果一个文件有很多函数/方法，每个都要有测试覆盖

## 测试后报告生成（自动）

测试文件生成后，系统会自动执行以下步骤（无需 AI 参与）：

1. **执行 vitest**：系统使用 `vitest run --reporter=json` 运行所有生成的测试文件
2. **生成 HTML 报告**：系统自动将 vitest JSON 结果转为固定样式的 HTML 报告
3. **报告路径**：HTML 报告保存在 `{testDataDir}/frontend/reports/{projectSlug}/frontend-test-{timestamp}.html`
4. **前端展示**：通过 `GET /api/tests/runs/:id/report` 接口可直接查看报告

请立即开始生成测试文件。记得：**每个源码文件都必须有对应的 .test.ts 文件**。
