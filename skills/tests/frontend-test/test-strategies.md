# 前端测试策略配置

本文件定义各类前端文件的测试策略。由 `frontend-test` SKILL 引用。

---

## 导出类型判定表

Read 源码后，根据以下规则判定导出类型并选择对应策略：

| 判定条件 | exportType | testCategory |
|----------|-----------|--------------|
| `export default defineComponent(...)` 或 `<script setup>` | component | components |
| `export const useXxx = ...` 且内部调用 Vue API (ref/reactive/computed) | composable | composables |
| `export const useXxxStore = defineStore(...)` | store | stores |
| `export default function xxx(...)` 且不含 Vue API | function | config |
| `export default function xxx(...)` 且含 Vue API 调用 | composable | composables |
| `export default { ... }` 或 `export const xxx = { ... }` | object | config |
| `export const xxx = ...` (纯值/纯函数，无框架依赖) | constant/function | utils |
| `export function xxx(...)` (纯函数，无框架依赖) | function | utils |

**判定优先级**：component > store > composable > config > utils

---

## 分类测试策略

### config（配置生成函数/对象）

**适用**：theme.js、options.js、constants.js 等导出配置对象的文件

**策略模板**：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 根据源码导出类型选择正确的 import 方式
// 函数导出: import getChartTheme from '@/xxx/theme'
// 对象导出: import themeConfig from '@/xxx/config'

// Mock 内部依赖（根据 fileAnalysis.dependencies 生成）
vi.mock('@/xxx/core/useTheme', () => ({
  useTheme: vi.fn(() => ({ theme: ref('light') }))
}))
vi.mock('@/xxx/core/theme/index', () => ({
  getBaseOption: vi.fn(() => ({ /* 基础配置 */ }))
}))

describe('模块名', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 如果是函数导出 — 必须先调用再断言
  it('应该返回正确的配置对象', () => {
    const result = getChartTheme()   // ← 调用函数
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')  // ← 断言返回值
  })

  it('应该根据参数返回不同配置', () => {
    const resultA = getChartTheme(true)
    const resultB = getChartTheme(false)
    // 断言两者的差异
  })

  it('应该包含必要的基础字段', () => {
    const result = getChartTheme()
    expect(result).toHaveProperty('legend')
    expect(result).toHaveProperty('tooltip')
  })
})
```

**必须测试的维度**（每个文件至少 3 个用例）：
1. 调用函数后返回值是对象且包含预期字段
2. 不同参数产生不同配置（如 horizontal true/false）
3. 不同条件产生不同配置（如 dark/light 主题）
4. 依赖被正确调用（如 useTheme 被调用）

---

### utils（纯工具函数）

**适用**：无框架依赖的纯函数

**策略模板**：

```typescript
import { describe, it, expect } from 'vitest'
import { functionName } from '@/utils/xxx'

describe('functionName', () => {
  it('应该 [正常情况]', () => {
    expect(functionName(input)).toBe(expected)
  })

  it('应该 [边界情况]', () => {
    expect(functionName(edgeInput)).toBe(expected)
  })

  it('应该 [异常情况]', () => {
    expect(functionName(badInput)).toBe(expected)
  })
})
```

**必须测试的维度**（每个函数至少 3 个用例）：
1. 正常输入 → 正确输出
2. 边界值（空字符串、0、null、undefined、空数组）
3. 异常输入（负数、非法类型）

---

### components（Vue 组件）

**适用**：`.vue` 文件或 `defineComponent` 导出

**策略模板**：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ComponentName from '@/components/xxx/ComponentName.vue'

// Mock 第三方依赖
vi.mock('vue-router')
vi.mock('echarts')

describe('ComponentName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应该正确渲染', () => {
    const wrapper = mount(ComponentName, {
      global: { stubs: { NButton: true, ElButton: true } }
    })
    expect(wrapper.find('.key-element').exists()).toBe(true)
  })

  it('应该响应 props 变化', () => {
    const wrapper = mount(ComponentName, {
      props: { data: mockData }
    })
    expect(wrapper.text()).toContain('expected text')
  })

  it('应该触发事件', async () => {
    const wrapper = mount(ComponentName, { /* ... */ })
    await wrapper.find('.trigger').trigger('click')
    expect(wrapper.emitted('update')).toBeTruthy()
  })
})
```

**必须测试的维度**（每个组件至少 4 个用例）：
1. 渲染输出：关键元素存在、文本正确
2. Props：不同 props 产生不同渲染
3. 交互：trigger 事件后状态/emit 正确
4. 边界：空数据、loading 状态

---

### stores（Pinia Store）

**适用**：`defineStore` 导出

**策略模板**：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useXxxStore } from '@/stores/xxx'

vi.mock('@/api/xxx', () => ({
  fetchXxx: vi.fn()
}))

describe('useXxxStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('应该有正确的初始状态', () => {
    const store = useXxxStore()
    expect(store.data).toEqual([])
  })

  it('action 应该更新状态', async () => {
    const store = useXxxStore()
    await store.someAction()
    expect(store.data).toBeDefined()
  })
})
```

**必须测试的维度**（每个 store 至少 4 个用例）：
1. 初始状态正确
2. Action 调用后 state 变更
3. Getter 计算结果正确
4. 异步 action 的 loading/error 状态

---

### composables（Vue Composable）

**适用**：以 `use` 开头、内部使用 Vue 响应式 API 的函数

**策略模板**：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-router')
vi.mock('@/api/xxx')

// 方法1: 用宿主组件测试
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

describe('useXxx', () => {
  it('应该返回响应式数据', () => {
    const { result } = withComposable(() => useXxx())
    expect(result.data).toBeDefined()
  })
})
```

**必须测试的维度**（每个 composable 至少 3 个用例）：
1. 返回值包含预期的响应式属性/方法
2. 方法调用后响应式状态正确更新
3. 清理/销毁逻辑（如定时器、事件监听器）
