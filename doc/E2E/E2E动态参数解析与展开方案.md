# E2E 动态参数解析与展开方案

## 一、背景

### 1.1 问题

发现阶段提取的路由中，大量路径包含动态参数（如 `/app/:appId/agent`），但实际测试时需要真实值（如 `/app/base_app/agent`）。

当前链路状态：

| 阶段 | 行为 | 问题 |
|------|------|------|
| 发现 | `page-discovery.ts` 有 `paramValues` 机制，但浏览器未导航到动态路由页，所以永远为空 `{}` | 参数解析不生效 |
| 存储 | `PageConfig` 只有 `id/name/url/path/description` | 无参数字段 |
| 管理 UI | 编辑页面只有 name/path 输入框 | 用户无法配置参数值 |
| 测试执行 | 带有 `:appId` 的 URL 原样传给 AI Agent | AI 需要自己猜/查参数值 |

### 1.2 目标

1. 发现时自动识别路径中的动态参数名（`:appId`、`:id` 等）
2. 管理页面允许用户手动填写参数的实际值（如 `appId: [base_app, demo_app]`）
3. E2E 测试时按参数列表自动展开成多条可测试 URL

---

## 二、数据模型变更

### 2.1 PageConfig 扩展

**文件**: `server/src/services/config.ts`

```typescript
export interface PageConfig {
  id: string;
  name: string;
  url: string;              // 模板 URL，如 /setting-app/index.html#/app/:appId/agent
  path: string;             // 路由路径，如 /app/:appId/agent
  description?: string;

  // === 新增 ===
  params?: Record<string, string[]>;   // 动态参数映射，如 { ":appId": ["base_app", "demo_app"] }
  hasDynamicParams?: boolean;          // 是否含有动态参数（发现时自动标记）
}
```

**示例数据**：

```json
{
  "id": "setting-app-AgentList-24",
  "name": "智能体列表",
  "url": "/setting-app/index.html#/app/:appId/agent",
  "path": "/app/:appId/agent",
  "hasDynamicParams": true,
  "params": {
    ":appId": ["base_app"]
  }
}
```

---

## 三、发现阶段改造

### 3.1 自动识别动态参数

**文件**: `server/src/services/page-discovery.ts`（约第 485-489 行，生成 PageConfig 的位置）

发现时，从路由路径中提取所有 `:xxx` 段作为参数名，并标记 `hasDynamicParams`：

```typescript
pages: routes.map((r, i) => {
  // 从路径提取动态参数名
  const paramNames = r.path.match(/:\w+/g) || [];
  const hasDynamicParams = paramNames.length > 0;

  return {
    id: `${entry}-${r.name || groupId}-${i}`,
    name: r.title,
    url: r.concreteUrl,
    path: r.path,
    hasDynamicParams,
    params: hasDynamicParams
      ? Object.fromEntries(paramNames.map(p => [p, []]))  // 初始为空数组，等用户填充
      : undefined,
  };
}),
```

### 3.2 增强：从 API 自动获取参数候选值（可选）

发现完成后，可以尝试通过项目后端 API 获取参数候选值。例如对 `:appId`，调用 `{apiBaseUrl}/app/list` 获取应用列表。这作为增强功能，一期不做。

---

## 四、管理页面 UI 改造

### 4.1 页面列表展示

**文件**: `web/src/views/SettingsView.vue`

含有动态参数的页面，在页面列表中显示参数标识：

```
┌──────────────────────────────────────────────────────┐
│ ✅ 智能体列表   /app/:appId/agent         🔧 动态参数  │
│    ↳ :appId = base_app                               │
│ ✅ 用户管理     /app/:appId/setting/permission/user   🔧 动态参数  │
│    ↳ :appId = (未配置)                                │
│ ✅ 代码管理     /code                                │
└──────────────────────────────────────────────────────┘
```

### 4.2 参数编辑弹窗

点击"动态参数"或编辑页面时，如果有 `hasDynamicParams`，展示参数配置区域：

```
┌──────────────────────────────────────────────────┐
│ 编辑页面 — 智能体列表                              │
│                                                   │
│ 页面名称: [智能体列表        ]                      │
│ 路由路径: /app/:appId/agent   (只读)               │
│                                                   │
│ ── 动态参数配置 ──                                 │
│                                                   │
│ :appId  [base_app, demo_app     ] [编辑] [+添加]   │
│         预览: /app/base_app/agent                  │
│                /app/demo_app/agent                  │
│                                                   │
│ :id     [                         ] [编辑] [+添加] │
│         (未配置，E2E 测试将跳过此页面)               │
│                                                   │
│                              [保存]  [取消]         │
└──────────────────────────────────────────────────┘
```

**参数值编辑交互**：

- 点击"编辑"弹出多值输入（tag input 风格），每个值是一个标签
- 点击"+添加"添加新值
- 输入框支持逗号分隔批量添加
- 下方实时预览展开后的 URL 列表
- 未配置参数值的页面，E2E 测试时自动跳过并标记"需配置参数"

### 4.3 前端改动点

`SettingsView.vue` 中需要改动的位置：

| 位置 | 当前 | 改为 |
|------|------|------|
| 页面列表项模板（~第 277-294 行） | 只显示名称和路径 | 有 `hasDynamicParams` 时额外显示参数状态 |
| `editPageForm` 定义（~第 447 行） | `{name, url, path, description, targetSetId}` | 新增 `params` 字段 |
| `startEditPage`（~第 812 行） | 赋值 name/path/url/description | 额外赋值 `params` |
| `doEditPage`（~第 821 行） | 只保存 name/path/url/description | 额外保存 `params` |
| 编辑弹窗模板（~第 304-316 行） | 只有 name/path 输入框 | 有动态参数时增加参数编辑区 |

---

## 五、测试执行改造

### 5.1 resolvePages 增强

**文件**: `server/src/services/test-runner.ts`（~第 567-574 行）

将含动态参数的页面展开为多条实际 URL：

```typescript
function resolvePages(project: TestProject, scope: string): PageConfig[] {
  const rawPages = scope === 'all'
    ? (project.pageSets || []).flatMap(ps => ps.pages)
    : (project.pageSets || []).find(ps => ps.id === scope)?.pages || [];

  // 展开动态参数
  const expanded: PageConfig[] = [];
  for (const page of rawPages) {
    if (!page.hasDynamicParams || !page.params) {
      expanded.push(page);
      continue;
    }

    // 检查所有参数是否都有值
    const paramEntries = Object.entries(page.params);
    const allConfigured = paramEntries.every(([, values]) => values.length > 0);

    if (!allConfigured) {
      // 参数未配置，标记跳过
      expanded.push({
        ...page,
        name: `${page.name} (参数未配置，已跳过)`,
      });
      continue;
    }

    // 展开参数组合（笛卡尔积）
    const combinations = generateCombinations(page.params);
    for (const combo of combinations) {
      let resolvedUrl = page.url;
      let resolvedPath = page.path;
      for (const [param, value] of Object.entries(combo)) {
        resolvedUrl = resolvedUrl.replace(param, value);
        resolvedPath = resolvedPath.replace(param, value);
      }
      expanded.push({
        ...page,
        id: `${page.id}-${Object.values(combo).join('-')}`,
        name: `${page.name} (${Object.values(combo).join('/')})`,
        url: resolvedUrl,
        path: resolvedPath,
        hasDynamicParams: false,  // 已展开
        params: undefined,
      });
    }
  }
  return expanded;
}

/** 生成参数的笛卡尔积组合 */
function generateCombinations(params: Record<string, string[]>): Record<string, string>[] {
  const entries = Object.entries(params);
  if (entries.length === 0) return [{}];

  const [key, values] = entries[0];
  const rest = generateCombinations(Object.fromEntries(entries.slice(1)));
  const result: Record<string, string>[] = [];
  for (const value of values) {
    for (const combo of rest) {
      result.push({ [key]: value, ...combo });
    }
  }
  return result;
}
```

### 5.2 AI Agent 提示词增强

展开后，AI Agent 收到的页面列表将是实际可访问的 URL：

```
## 待测试页面 (3页)
- 智能体列表 (base_app): http://localhost:5173/setting-app/index.html#/app/base_app/agent
- 智能体列表 (demo_app): http://localhost:5173/setting-app/index.html#/app/demo_app/agent
- 用户管理 (base_app): http://localhost:5173/setting-app/index.html#/app/base_app/setting/permission/user
```

不再需要 AI 自行猜测参数值。

---

## 六、后端 API 变更

### 6.1 页面更新接口改造

**文件**: `server/src/routes/projects.ts`

现有的 `POST /api/projects/:id/pages/update` 接口需要接受 `params` 字段：

```typescript
// 更新页面（已有，扩展 params 字段）
POST /api/projects/:id/pages/update
Body: {
  pageId: string;
  name?: string;
  path?: string;
  url?: string;
  description?: string;
  params?: Record<string, string[]>;    // 新增
  targetSetId?: string;
}
```

### 6.2 批量设置参数（新增）

方便一次性为同一个参数（如 `:appId`）设置所有相关页面的值：

```
POST /api/projects/:id/pages/batch-set-param
Body: {
  paramName: string;           // 如 ":appId"
  values: string[];            // 如 ["base_app", "demo_app"]
  scope?: string;              // 可选，限定某个页面集
}
```

这会找到项目中所有含该参数的页面，统一更新其 `params` 字段。

---

## 七、改动文件清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `server/src/services/config.ts` | ~5 行 | `PageConfig` 接口新增 `params`、`hasDynamicParams` 字段 |
| `server/src/services/page-discovery.ts` | ~15 行 | 生成 PageConfig 时自动提取动态参数名，标记 `hasDynamicParams` |
| `server/src/services/test-runner.ts` | ~50 行 | `resolvePages` 增加参数展开逻辑，新增 `generateCombinations` |
| `server/src/routes/projects.ts` | ~30 行 | `pages/update` 支持 `params` 字段，新增 `batch-set-param` 接口 |
| `web/src/api/projects.ts` | ~5 行 | 新增 `batchSetParam` API 调用 |
| `web/src/views/SettingsView.vue` | ~80 行 | 页面列表显示参数状态、编辑弹窗增加参数配置区 |

**总计**: 修改 6 文件，约 185 行。

---

## 八、实施优先级

| 顺序 | 内容 | 说明 |
|------|------|------|
| 1 | 数据模型扩展 | `PageConfig` 加 `params` + `hasDynamicParams` |
| 2 | 发现阶段自动识别 | 从路径中提取 `:xxx` 参数名 |
| 3 | 测试执行参数展开 | `resolvePages` 展开为实际 URL |
| 4 | 后端 API 支持 | update 接口支持 params，新增 batch-set-param |
| 5 | 管理页面 UI | 页面列表参数标识 + 编辑弹窗参数配置 |

---

## 九、验证方案

1. **发现验证**: 重新发现页面，检查含 `:appId` 的页面是否正确标记 `hasDynamicParams` 和空的 `params`
2. **管理页面验证**: 在设置页面编辑一个动态参数页面，添加 `appId: [base_app]`，保存后重新打开确认数据持久化
3. **批量设置验证**: 用 batch-set-param 接口一次性设置 `:appId = [base_app]`，检查所有相关页面
4. **测试执行验证**: 发起一个 E2E 测试（选一个含动态参数的页面集），查看日志中 AI 收到的页面列表是否为展开后的实际 URL
5. **未配置跳过验证**: 发起测试，含未配置参数的页面应标记"参数未配置，已跳过"
