---
name: deploy-school
description: 新学校一键部署：信息收集 → 注册 → 兼容性检查 → 配置生成 → 打包 → 远程部署，全流程自动
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
tags: ["deploy", "school", "full-cycle", "auto"]
dependencies: ["db-compat", "git-helper", "notifier"]
---

# 学校部署全流程（全自动）

## 触发方式

- 用户输入 `/deploy-school`（交互式收集信息）
- 或通过 API 提供完整学校信息

## 必要信息

| 字段 | 说明 | 示例 |
|------|------|------|
| name | 学校名称 | 贵州水利 |
| code | 学校编码 | guizhou_shuili |
| type | 数据库类型 | mysql / dameng |
| port | 服务端口 | 9996 |
| dbHost | 数据库地址 | 172.18.102.107 |
| dbPort | 数据库端口 | 5237 |
| dbUser | 数据库用户 | SYSDBA |
| dbPassword | 数据库密码 | *** |
| deployHost | 部署服务器 | 192.168.1.100 |
| amapKey | 高德地图 Key | 可选 |

## 执行步骤（全自动）

### 1. 信息收集（如未提供）

如果通过命令行触发，交互式收集上述信息。

### 2. 注册到 schools.yaml

将学校信息写入 `data/schools.yaml`，status=pending。

### 3. 数据库兼容性检查

调用 `db-compat` Skill：
- 如果 type=dameng，扫描所有原生 SQL 检查兼容性
- 如果 type=mysql，跳过
- 输出兼容性报告

### 4. 生成配置文件

从模板生成 yml 配置：
- 模板目录：`data/templates/yml-template/`
- 替换占位符：`{{PORT}}`, `{{DB_HOST}}`, `{{DB_TYPE}}`, `{{AMAP_KEY}}` 等
- 输出到主系统 `doc/{学校名}/yml/`

生成的文件：
- `application.yml`
- `application-dev.yml`（数据库连接）
- `application-common.yml`（通用配置 + helperDialect）
- `application-security.yml`
- `application-dblink.yml`
- `application-agent.yml`
- `application-mcp-server.yml`（如需要）

### 5. 编译验证

在主系统执行编译检查，确保配置无误：
```bash
cd C:/FengSuKeJi/agent/backend && mvn compile
```

### 6. Git 提交

调用 `git-helper` Skill：
- 创建分支 `deploy/{学校编码}`
- 提交所有新生成的配置文件
- 推送到远程

### 7. 远程部署（可选）

如果提供了 deployHost：
- SSH 连接目标服务器
- 拉取最新代码
- 替换 yml 配置
- 重启服务
- 等待健康检查通过

### 8. 更新状态

- 更新 schools.yaml 中 status=deployed
- 记录部署时间和版本

### 9. 通知

调用 `notifier` Skill 通知部署结果。

## 配置模板占位符

```
{{SCHOOL_NAME}}     → 学校名称
{{SCHOOL_CODE}}     → 学校编码
{{PORT}}            → 服务端口
{{DB_TYPE}}         → dm / mysql
{{DB_HOST}}         → 数据库地址
{{DB_PORT}}         → 数据库端口
{{DB_NAME}}         → AGENT_PORTAL
{{DB_USER}}         → 数据库用户
{{DB_PASSWORD}}     → 数据库密码
{{AMAP_KEY}}        → 高德地图 Key
{{HELPER_DIALECT}}  → dm / mysql
```

## 失败恢复

- 编译失败：检查配置文件语法，尝试自动修复
- 远程部署失败：回滚到部署前状态，保留配置文件
- SSH 连接失败：跳过远程部署，标记 status=configured
