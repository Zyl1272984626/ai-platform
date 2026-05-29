---
name: migrate-db
description: 数据库兼容性迁移：扫描不兼容 SQL → 生成修复方案 → 自动修改 → 编译验证，全流程自动
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
tags: ["database", "migration", "full-cycle", "auto"]
dependencies: ["db-compat", "code-analyzer", "git-helper"]
---

# 数据库迁移全流程（全自动）

## 触发方式

```
/migrate-db dameng
```

## 背景

当需要将系统从 MySQL 适配到其他数据库（如达梦）时，自动扫描并修复所有不兼容的 SQL。

## 执行步骤

### 1. 确定目标数据库类型

支持的目标类型：
- `dameng` — 达梦数据库

### 2. 全局扫描

调用 `db-compat` Skill 扫描以下位置：
- JPA Repository 中的 `@Query` 原生 SQL
- JdbcTemplate 使用的 SQL 语句
- JPA Entity 的 `columnDefinition`
- MyBatis XML（如有）
- 配置文件中的 SQL 片段

### 3. 生成兼容性报告

列出所有不兼容项：
| 文件 | 行号 | 原始 SQL | 问题 | 建议修复 |
|------|------|---------|------|---------|

### 4. 自动修复

按修复策略自动修改：
- `NOW()` → `CURRENT_TIMESTAMP`
- `CURDATE()` → `CURRENT_DATE`
- `DATE(x)` → `CAST(x AS DATE)`
- `IF(a,b,c)` → `CASE WHEN a THEN b ELSE c END`
- `LIMIT n` → 使用 API 替代
- `ON DUPLICATE KEY UPDATE` → 先查后写
- `LONGTEXT` → `TEXT`
- `TINYINT(1)` → `SMALLINT`
- `JSON` → `TEXT`

### 5. 编译验证

```bash
mvn compile -f backend/pom.xml
```

### 6. 生成迁移报告

在 `doc/{目标库类型}迁移/` 下生成：
- 兼容性分析报告
- 修改清单
- DDL 差异（新增安装时需注意的）

### 7. Git 提交

提交所有修改，分支名 `migrate/{目标库类型}`。
