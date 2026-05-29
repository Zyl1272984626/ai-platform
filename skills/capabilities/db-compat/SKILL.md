---
name: db-compat
description: 数据库兼容性检查：SQL 语法检测、类型映射、DDL 差异比对
allowed-tools: ["Read", "Glob", "Grep"]
tags: ["database", "compatibility"]
---

# 数据库兼容性检查

## 能力

### scan — 全局扫描
扫描项目中所有与数据库相关的代码，检测不兼容的 SQL 语法。

扫描目标：
- `@Query` 注解中的原生 SQL
- JdbcTemplate 中的 SQL 字符串
- Entity 的 `columnDefinition`
- MyBatis XML
- 配置文件中的 SQL 片段

### check — 单文件检查
对指定文件进行兼容性检查。

### fix — 自动修复建议
对扫描到的问题给出修复建议。

## 检测规则（MySQL → 达梦）

| MySQL 语法 | 问题 | 标准替代 |
|------------|------|---------|
| `NOW()` | 达梦不支持 | `CURRENT_TIMESTAMP` |
| `CURDATE()` | 达梦不支持 | `CURRENT_DATE` |
| `DATE(x)` | 函数不存在 | `CAST(x AS DATE)` |
| `IF(a,b,c)` | 达梦不支持 | `CASE WHEN a THEN b ELSE c END` |
| `LIMIT n` | 语法不同 | 使用 API 替代或 ROWNUM |
| `ON DUPLICATE KEY UPDATE` | 达梦不支持 | 先查后写 |
| `LONGTEXT` | 类型不存在 | `TEXT` |
| `TINYINT(1)` | 达梦不支持 | `SMALLINT` |
| `JSON` | 达梦不支持 | `TEXT` |
| `VALUES(col)` | UPSERT 中不支持 | 应用层处理 |

## 输出

```json
{
  "totalIssues": 15,
  "files": [
    {
      "path": "backend/src/.../Foo.java",
      "line": 89,
      "original": "NOW()",
      "issue": "达梦不支持 NOW() 函数",
      "fix": "CURRENT_TIMESTAMP",
      "severity": "high"
    }
  ]
}
```
