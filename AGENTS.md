# AI Platform 项目规则

## 启动方式
开发模式需要同时启动前后端两个进程：
- 后端：`cd server && npm run dev`（Express，端口 3100）
- 前端：`cd web && npm run dev`（Vite，端口 3200）

## 后端约束
- HTTP 接口请求类型只能为 POST 或 GET，不使用 PUT/DELETE
- 写操作用 POST，通过路径或参数区分操作类型（如 `/update`、`/delete`）

## 文档
- 生成的文档放在 `/doc` 目录下

## 数据存储
- 项目配置主文件：`server/data/platform-config.json`（轻量，只存索引）
- 项目页面数据：`server/data/projects/{id}/project.json`（独立存储）
- 原始发现数据：`server/data/projects/{id}/discovery-result.json`
- 页面上下文：`server/data/projects/{id}/page-context.json`
