---
name: api-discovery
description: 扫描源码发现所有 HTTP API 接口，分析后端路由和前端调用，按业务模块分组，生成可执行的测试定义
allowed-tools: ["Read", "Glob", "Grep", "Bash", "Write"]
tags: ["api", "discovery", "test"]
---

# API 接口发现

你是一个 API 接口分析专家。请分析以下项目的源码，找出所有 HTTP API 接口，并生成可直接执行的测试定义。

## 项目信息
- 项目名称: {{projectName}}
- 源码路径: {{sourcePath}}
- 后端 API 地址: {{apiBaseUrl}}
- 登录页: {{apiBaseUrl}}{{loginUrl}}
- 登录凭据: {{username}} / {{password}}

## 任务
1. 扫描源码中的后端路由定义（如 Express Router、Spring Controller 等）
2. 扫描前端代码中的 API 调用（如 axios.get/post、fetch 等）
3. 综合两端信息，按业务模块分组
4. 对每个接口记录：方法、路径、请求参数、响应结构、描述
5. 【关键】获取真实测试数据：
   - 先调用登录接口获取 Token
   - 调用各模块的列表接口（如 GET /api/users?page=1&size=1）
   - 从返回数据中提取真实 ID（userId、sessionId、knowledgeId 等）
   - 将这些 ID 写入 testData 字段，后续测试用 {{testData.xxx}} 引用
6. 为每个接口生成正向 + 异常测试用例（含断言）

## 测试数据获取策略
不需要人工配置参数，也不需要数据库连接。通过实际调用 API 获取：
- 列表接口 → 提取第一条数据的 ID
- 详情接口 → 用列表获取的 ID
- 创建接口 → 使用合理的测试数据
- 删除/更新接口 → 先创建再操作

## 输出格式
请严格按照以下 JSON 格式输出（用 ```json 包裹），必须包含两个文件：

### 文件 1: api-discovery.json（接口清单）
```json
{
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

### 文件 2: api-tests.json（测试定义）
```json
{
  "baseUrl": "{{apiBaseUrl}}",
  "authConfig": {
    "type": "loginFirst",
    "loginEndpoint": "/api/login",
    "loginBody": { "username": "{{username}}", "password": "{{password}}" },
    "tokenPath": "data.token",
    "tokenHeader": "Authorization"
  },
  "testData": {
    "userId": "从列表接口获取的真实ID"
  },
  "testModules": [
    {
      "moduleId": "模块ID",
      "moduleName": "模块名称",
      "tests": [
        {
          "id": "测试ID",
          "name": "测试名称",
          "method": "POST",
          "path": "/api/xxx",
          "body": {},
          "needAuth": true,
          "expect": {
            "status": 200,
            "body": { "code": 200 }
          }
        }
      ]
    }
  ]
}
```

请开始分析源码并输出结果。
