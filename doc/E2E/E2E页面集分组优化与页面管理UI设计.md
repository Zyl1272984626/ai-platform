# 页面集分组优化 + 页面管理 UI 设计

## 一、当前问题

### 1.1 分组太碎，单页页面集过多

当前自动发现生成了 **27 个页面集，其中 18 个只有 1 个页面**（占 67%）。

| 子应用 | 页面集数 | 单页集数 | 原因 |
|--------|----------|----------|------|
| index | 4 个集（9页） | 2 个 | user(5页) 合理，chat(1页)/mobile(1页) 碎片 |
| chat | 4 个集（9页） | 2 个 | 和 index 完全重复（两个子应用路由相同） |
| setting-system | 13 个集（21页） | 10 个 | 每个 CRUD 页面（code/model/config 等）独占一个集 |
| setting-app | 3 个集（36页） | 2 个 | app 集里塞了 34 页，没进一步细分 |

### 1.2 根本原因

当前分组逻辑（`page-discovery.ts` 的 `groupRoutes`）按**路由第一级路径段**分组：

```
/code           → 分组 "code"（1页）
/model          → 分组 "model"（1页）
/app/:appId/agent → 第一段是动态参数，取第二段 "agent" → 分组 "agent"
```

问题：
- setting-system 的每个页面都是独立的一级路由（`/code`、`/model`、`/config`...），导致每个页面一个分组
- index 和 chat 是同一套路由在不同子应用入口下，产生了重复分组
- setting-app 的 34 个页面全塞进了 "app" 一个集，没有按功能模块（权限/系统/智能体）细分

### 1.3 用户无法查看和调整

- 设置页面只显示"页面集: 27 个 | 页面: 75 个"，看不到具体内容
- 无法手动合并/拆分页面集
- 无法手动添加遗漏的页面
- 发现结果不准确时无法修正

---

## 二、改造目标

### 2.1 优化分组策略

| 场景 | 当前 | 改为 |
|------|------|------|
| setting-system 一级路由 `/code`, `/model` 等 | 每个独立一个集 | 合并为"系统管理"一个集 |
| setting-app `/app/:appId/setting/permission/*` | 全部塞进 "app" | 按 `setting/permission` 细分为"权限管理" |
| setting-app `/app/:appId/agent/*` | 全部塞进 "app" | 细分为"智能体管理" |
| index 和 chat 路由完全相同 | 重复生成 | 去重或合并 |

### 2.2 新增页面管理 UI

在设置页面的项目卡片上新增"管理页面"按钮，弹窗展示：
- 所有页面集及其下的页面列表
- 支持手动增删改页面
- 支持合并/拆分/重命名页面集
- 支持拖拽调整页面所属分组

---

## 三、分组策略优化方案

### 3.1 设计原则

分组规则必须是**通用的**，不硬编码任何项目特定的路径或名称。适用于任意 Vue/React SPA 项目。

### 3.2 两级分组架构

```
第一级：按子应用（入口）分组 — 天然的最高层级
    每个有效入口（web、admin、setting-system 等）就是一个子应用

第二级：按路径层级自动聚合 — 通用算法
    在子应用内部，根据路径层级关系和数量自动决定分组粒度
```

### 3.3 通用分组算法

```
算法步骤：

1. 子应用关联（不直接合并）
   - 如果两个子应用的路由列表完全相同（path 集合一致），标记为"关联子应用"
   - 在管理 UI 中展示关联关系，但保留各自的入口信息
   - 不直接合并：不同入口可能有不同的初始化逻辑或上下文（如 index 和 chat 虽路由相同但入口不同）
   - 在分组展示时可折叠显示关联子应用，避免重复展示页面列表

2. 路径规范化
   - 展开动态参数（:xxx → 实际值）
   - 去掉根路由 "/" 和登录路由 "/login"

3. 计算路径深度
   - 对每个路由，计算非动态路径段的数量
   - 例：/sys/code → depth=2, /app/:appId/agent → depth=2（:appId 不算）

4. 自动选择分组粒度
   - 统计子应用内所有路由的路径段数量分布
   - 如果大多数路由 depth ≥ 2：按第一段分组（如 /sys/code 和 /sys/config → "sys"）
   - 如果大多数路由 depth = 1：这些路由属于同级，合并为"首页功能"一个大组
   - 动态参数段不算分组依据，跳过取下一段

5. 小组智能合并（保守策略）
   - 仅当多个单页分组的**路由语义相近**时合并（如 /code 和 /model 同属系统管理）
   - 语义判断方法：单页分组间如果共享父级路径段（去除动态参数后），视为可合并
   - 对于语义无关的单页分组（如 /chat 和 /monitor），保留独立不合并
   - 避免将功能差异大的页面硬塞进"其他"分组，损失信息量
   - 阈值可配置，默认 ≤1 页且存在可合并对象时触发

6. 大组拆分建议（不自动执行）
   - 如果某个分组超过 10 个页面，标记为"建议拆分"
   - 在管理 UI 中展示拆分建议（按第二段路径可细分的预览）
   - 用户确认后才执行拆分，不做静默自动拆分
   - 原因：10+ 页面可能本就属于同一功能模块（如权限管理 12 页很正常），强行拆分反而不合理
```

### 3.4 算法示例（通用，不依赖具体路径名）

**示例 A：子应用路由深度 ≥ 2（如 admin 子应用）**

```
路由：/sys/code, /sys/config, /sys/database, /sys/storage,
      /permission/user, /permission/role, /permission/resource,
      /task/list, /task/execute

depth 分布：大部分 depth=2
→ 按第一段分组：sys(4页), permission(3页), task(3页)
```

**示例 B：子应用路由深度 = 1（如 setting-system 子应用）**

```
路由：/code, /model, /config, /datasource, /app, /monitor, ...

depth 分布：全部 depth=1
→ 无法按段分组，这些是同级路由
→ 合并为一个组："setting-system (全部, 14页)"
```

**示例 C：混合深度（如 setting-app 子应用）**

```
路由：/app/:appId/agent, /app/:appId/agent/edit-conversation,
      /app/:appId/setting/permission/user, /app/:appId/setting/sys/page,
      /comp-preview, /app-list

深度分布：有 depth=1 和 depth≥2
→ depth=1 的合并为"其他"
→ depth≥2 的按第一有效段分组：
   agent(4页), setting(14页), workflow(2页), ...
```

### 3.5 分组结果对比

**通用算法对本项目 75 页的预期结果**：

| 子应用 | 页面集 | 说明 |
|--------|--------|------|
| index/chat（关联） | 2 集：用户门户(5页)、其他(3页) | 关联展示，各自独立 |
| setting-system | 2 集：全部功能(15页)、任务管理(3页) | depth=1 合并 + depth≥2 独立 |
| setting-app | ~8 集：权限(5页)、系统配置(8页)、智能体(4页)、流程(2页)... | 按 depth≥2 分组 |

**优化前**：27 个页面集，18 个单页集  
**优化后**：约 12 个页面集，≤3 个单页集

### 3.6 与旧版 index.js 的对比

旧版 `index.js` 的分组是**人工定义的业务分组**（admin-sys、admin-perm 等），准确但需要手动维护。新版通用算法的目标是**接近人工分组的质量，但完全自动**，并支持用户在管理 UI 中微调。

---

## 四、页面管理 UI 设计

### 4.1 入口

项目卡片新增"管理页面"按钮：

```
[设为默认] [编辑] [发现页面] [管理页面] [检测] [删除]
```

### 4.2 页面管理弹窗布局

```
┌──────────────────────────────────────────────────────────┐
│ 页面管理 — 主系统(Agent)                                  │
│ 27 个页面集 | 75 个页面                                   │
│                                                           │
│ ┌─ 权限管理 (setting-app, 5页) ──────────────────────┐    │
│ │  ✅ 用户管理    /app/:appId/setting/permission/user │    │
│ │  ✅ 角色管理    /app/:appId/setting/permission/role │    │
│ │  ✅ 资源管理    /app/:appId/setting/permission/resource│ │
│ │  ✅ 用户组管理  /app/:appId/setting/permission/ug   │    │
│ │  ✅ 企微应用管理 /app/:appId/setting/permission/qwapp│  │
│ │  [+ 添加页面]  [重命名]  [删除分组]                  │    │
│ └────────────────────────────────────────────────────┘    │
│                                                           │
│ ┌─ 智能体管理 (setting-app, 4页) ───────────────────┐    │
│ │  ✅ 智能体列表    /app/:appId/agent                │    │
│ │  ✅ 编辑对话流    /app/:appId/agent/edit-conversation│  │
│ │  ✅ 编辑LLM      /app/:appId/agent/edit-llm        │    │
│ │  ✅ 智能体用户    /app/:appId/agent/user            │    │
│ └────────────────────────────────────────────────────┘    │
│                                                           │
│ ... 其他页面集 ...                                         │
│                                                           │
│ [+ 新建页面集]                                             │
│                                                           │
│                              [保存修改]  [取消]            │
└──────────────────────────────────────────────────────────┘
```

### 4.3 支持的操作

#### 一期（核心功能，覆盖 80% 场景）

| 操作 | 说明 |
|------|------|
| 查看页面集 | 展示所有页面集，每个可展开看页面列表 |
| 新建页面集 | 输入名称，创建空页面集 |
| 重命名页面集 | 修改页面集名称 |
| 删除页面集 | 删除整个分组（需确认） |
| 添加页面 | 在页面集内手动添加页面（名称+URL+路径） |
| 删除页面 | 移除单个页面 |
| 编辑页面 | 修改页面名称、路径、描述 |
| 移动页面 | 通过下拉选择目标页面集，移动页面到新分组 |

#### 二期（增强交互，后续迭代）

| 操作 | 说明 |
|------|------|
| 拖拽移动 | 拖拽页面到另一个页面集 |
| 合并页面集 | 将两个页面集合并为一个 |
| 拆分页面集 | 按路径前缀自动拆分为多个页面集 |
| 拆分建议 | 大组（>10页）自动展示拆分建议，用户确认后执行 |

### 4.4 API 设计

> **约束**：后端接口仅使用 GET（查询）和 POST（写入），不使用 PUT/DELETE。

```
GET  /api/projects/:id/pages              → 获取页面集列表（已有）
POST /api/projects/:id/pages/save         → 批量保存页面集（已有，替代原 PUT）
POST /api/projects/:id/page-sets/create   → 新建页面集
POST /api/projects/:id/page-sets/update   → 更新页面集（重命名等）
POST /api/projects/:id/page-sets/delete   → 删除页面集
POST /api/projects/:id/page-sets/:setId/pages/add    → 添加页面
POST /api/projects/:id/pages/update       → 更新页面
POST /api/projects/:id/pages/delete       → 删除页面
```

---

## 五、项目数据分离

### 5.1 问题

当前所有项目数据（pageSets、discoveryResult）都存在 `platform-config.json` 中。

| 指标 | 当前（1 个项目） | 预估（10 个项目） |
|------|-----------------|------------------|
| 文件大小 | 52KB / 1408 行 | ~500KB / 14000 行 |
| pageSets 数据 | 15KB | ~150KB |
| discoveryResult（原始探测数据） | 18KB | ~180KB |
| 基础配置 | <1KB | <1KB |

问题：配置文件越来越庞大，读写效率低，git diff 噪音大。

### 5.2 分离方案

**主配置只存项目索引，详情按项目独立存储。**

```
server/data/
  platform-config.json              # 主配置（轻量）
    {
      "aiPlatformRoot": "...",
      "e2eDataDir": "...",
      "apiTestBaseUrl": "...",
      "defaultProjectId": "agent-main",
      "projects": [
        {
          "id": "agent-main",
          "name": "主系统(Agent)",
          "baseUrl": "http://localhost:5173",
          "apiBaseUrl": "http://localhost:9998",
          "loginUrl": "/web/index.html#/login",
          "username": "fskjadmin",
          "password": "fskj_dst_2023",
          "sourcePath": "C:/FengSuKeJi/agent",
          "status": "active"
          // 不再包含 pageSets、discoveryResult、discoveredAt
        }
      ]
    }

  projects/
    agent-main/
      project.json                  # 页面集数据（发现/手动管理的结果）
        {
          "pageSets": [...],
          "discoveredAt": "2026-06-01T04:01:12.069Z",
          "totalPages": 75
        }
      discovery-result.json         # 原始发现数据（用于调试/重放）
        { "runtime": {...}, "rawRoutes": {...} }
      page-context.json             # 知识库骨架（已生成）
        { "index-UserChat-0": {...}, ... }

    another-project/
      project.json
      discovery-result.json
      page-context.json
```

### 5.3 读写改造

**config.ts 变更**：

```typescript
// 项目列表从 platform-config.json 读取（轻量）
// 项目详情（pageSets）从 projects/{id}/project.json 读取

const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

function getProjectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

// 读项目页面集（从独立文件）
function loadProjectPages(projectId: string): { pageSets: PageSet[]; discoveredAt?: string } {
  const filePath = path.join(getProjectDir(projectId), 'project.json');
  if (!fs.existsSync(filePath)) return { pageSets: [] };
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// 写项目页面集（到独立文件）
function saveProjectPages(projectId: string, data: { pageSets: PageSet[]; discoveredAt?: string }) {
  const dir = getProjectDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(data, null, 2));
}
```

**API 返回合并数据**：
- `GET /api/projects` 返回项目列表，每个项目动态合并 `project.json` 的 pageSets
- `GET /api/projects/:id/pages` 直接读 `projects/{id}/project.json`
- `PUT /api/projects/:id/pages` 写入 `projects/{id}/project.json`
- `POST /api/projects/:id/discover` 发现完成后写 `project.json` + `discovery-result.json`

### 5.4 迁移

启动时检测：如果 `platform-config.json` 中项目仍有内联 `pageSets`，自动迁移到独立文件并从主配置中移除。

---

## 六、改动文件清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `server/src/services/config.ts` | ~60 行 | 项目数据读写改为独立文件，迁移逻辑 |
| `server/src/services/page-discovery.ts` | ~80 行 | `groupRoutes` 改用通用深度聚合算法 + 子应用关联标记，写入独立文件 |
| `server/src/routes/projects.ts` | ~60 行 | 新增页面集/页面 CRUD API（仅 POST/GET），读独立文件 |
| `web/src/views/SettingsView.vue` | ~150 行 | 页面管理弹窗 UI（一期：查看+增删改+移动） |
| `web/src/api/projects.ts` | ~30 行 | 新增页面管理 API 调用 |

---

## 七、实施优先级

| 顺序 | 内容 | 说明 |
|------|------|------|
| 1 | 项目数据分离 | config.ts 读写改造，迁移旧数据 |
| 2 | 优化分组策略 | 修改 groupRoutes，用通用深度聚合算法 |
| 3 | 子应用关联标记 | index/chat 相同路由标记关联，保留独立 |
| 4 | 页面管理 API | 后端 CRUD（仅 POST/GET） |
| 5 | 页面管理 UI 一期 | 查看页面集 + 增删改 + 重命名 + 下拉移动 |
| 6 | 页面管理 UI 二期 | 拖拽、合并拆分、拆分建议 |
