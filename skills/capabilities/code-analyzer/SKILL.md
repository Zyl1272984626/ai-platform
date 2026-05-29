---
name: code-analyzer
description: 代码分析能力：静态扫描、依赖分析、变更影响范围评估、Bug 定位
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
tags: ["analysis", "code"]
---

# 代码分析器

## 能力

### locate — Bug 定位
输入 Bug 描述，输出可能的根因和相关文件：
1. 提取描述中的关键词（表名、字段名、功能名称）
2. 在代码库中搜索相关文件
3. 分析调用链（Controller → Service → Repository）
4. 识别最近的 Git 变更（git log/git blame）
5. 生成根因分析和修复方案

### impact — 变更影响分析
输入要修改的文件/方法，输出影响范围：
1. 搜索所有引用该文件/方法的地方
2. 分析前端 API 调用
3. 分析数据库查询依赖
4. 标记受影响的测试用例

### scan — 静态扫描
扫描代码库中的潜在问题：
- 安全漏洞（SQL 注入、XSS、硬编码密码）
- 代码异味（过长方法、重复代码）
- 性能问题（N+1 查询、大事务）
- 兼容性问题（数据库特定语法）

### compile-check — 编译验证
执行编译并分析错误：
```bash
mvn compile -f backend/pom.xml
```
编译失败时自动解析错误信息，尝试定位问题代码。

## 输出格式

所有分析结果以结构化 JSON 输出：
```json
{
  "analysis": "分析结论",
  "affectedFiles": ["文件路径列表"],
  "fixPlan": "修复方案",
  "riskLevel": "low|medium|high",
  "details": []
}
```
