---
name: api-discovery
description: 扫描源码发现所有 HTTP API 接口，分析后端路由和前端调用，按业务模块分组，生成可执行的测试定义
allowed-tools: ["Read", "Glob", "Grep", "Write"]
tags: ["api", "discovery", "test"]
usage: 在设置页面的项目操作区点击「发现接口」时自动加载。扫描源码中的路由定义，生成按模块分组的 API 测试定义文件。生成的数据用于测试中心的 API 接口测试。
constraints:
  - 只允许使用 Read、Glob、Grep、Write 四个工具
  - 需要项目已配置正确的源码路径
---

# API 接口发现

你是一个 API 接口分析专家。请分析项目源码，找出所有 HTTP API 接口并生成发现结果。

## 项目信息
- 项目名称: {{projectName}}
- 源码路径: {{sourcePath}}
- 后端 API 地址: {{apiBaseUrl}}
- 登录页: {{apiBaseUrl}}{{loginUrl}}
- 登录凭据: {{username}} / {{password}}

## 工具使用约束（必须严格遵守）

1. **只允许使用 Glob、Grep、Read、Write 四个工具**
2. **禁止使用 TodoWrite、Bash、TaskCreate 等任何其他工具**
3. **禁止输出进度跟踪、TODO 列表或中间状态**
4. 用 Glob 一次性扫描路由文件，不要逐个目录重复扫描
5. 用 Grep 搜索路由模式（router.get、router.post、app.get 等），高效定位接口定义
6. 只 Read 路由文件和控制器文件，跳过测试文件和配置文件

## 执行步骤

### 步骤 1：快速扫描路由文件
- `Glob("**/routes/**/*.{ts,js}")` — 扫描路由定义文件
- `Glob("**/router/**/*.{ts,js}")` — 备用路径
- `Glob("**/controller/**/*.{ts,js}")` — 控制器文件

### 步骤 2：分析接口定义
- `Grep("router\.(get|post)|app\.(get|post)|\.route\(", pattern)` — 搜索路由注册
- `Read` 关键路由文件，提取 method、path、参数和描述
- 前端 API 调用：`Grep("axios\.(get|post)|fetch\(|api\.", pattern)`

### 步骤 3：综合分组并写入
- 按业务模块分组，生成最终 JSON
- 用 Write 工具写入 `api-discovery.json`

**充分扫描，不要遗漏，直到分析完成再写入结果。**

## 输出格式

### 写入文件: {{outputDir}}/api-discovery.json
```json
{
  "discoveredAt": "ISO日期",
  "projectId": "项目ID",
  "summary": {
    "totalModules": 10,
    "totalEndpoints": 80,
    "scanDuration": 0
  },
  "modules": [
    {
      "id": "模块ID(英文)",
      "name": "模块名称(中文)",
      "description": "模块描述",
      "endpoints": [
        {
          "id": "接口ID",
          "name": "接口名称",
          "method": "GET/POST",
          "path": "/api/xxx",
          "description": "接口描述",
          "params": {},
          "response": {}
        }
      ]
    }
  ]
}
```

请立即开始分析。
