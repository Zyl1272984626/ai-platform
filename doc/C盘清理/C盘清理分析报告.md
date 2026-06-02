# C盘清理分析报告

> 扫描时间：2026-06-01
> C盘总容量：238 GB，已用：200 GB，可用：39 GB（使用率 84%）

---

## 一、磁盘空间分布概览

| 目录 | 大小 | 说明 |
|------|------|------|
| `C:\WINDOWS` | 28.15 GB | 系统文件（含 Installer 14.81 GB、WinSxS 10.14 GB） |
| `C:\Users\Administrator\AppData` | 60.74 GB | 应用数据（最大头） |
| `C:\Program Files` | 15.13 GB | 64位程序（JetBrains 3.93G、Office 4.10G、WindowsApps 7.81G） |
| `C:\Program Files (x86)` | 12.91 GB | 32位程序（Lenovo 6.31G、Microsoft 3.50G、WPS 0.90G） |
| `C:\FengSuKeJi` | 13.95 GB | 项目文件 |
| `C:\ProgramData` | 11.76 GB | 公共数据（Lenovo 5.81G、Adobe 1.55G、Microsoft 2.49G） |

---

## 二、可安全删除项（低风险，直接清理）

### 1. 回收站 — 331个文件
- 操作：右键桌面回收站 → 清空回收站
- 或运行：`rd /s /q C:\$Recycle.Bin`

### 2. 系统临时文件 — 约 1.8 GB
| 路径 | 大小 | 清理命令 |
|------|------|----------|
| `C:\Users\Administrator\AppData\Local\Temp` | 1.79 GB | 全选删除（跳过占用文件） |
| `C:\TEMP` | 极小 | 直接删除内容 |
| `C:\tmp` | 极小 | 直接删除内容 |
| `C:\adobeTemp` | 极小 | 直接删除整个文件夹 |

### 3. 旧版 Cursor 数据 — 1.98 GB
- 路径：`C:\Users\Administrator\AppData\Roaming\Cursor_old`
- 说明：旧版 Cursor 编辑器的遗留数据，已无用
- **预计释放：~1.98 GB**

### 4. 百度浏览器数据 — 1.51 GB
- 路径：`C:\Users\Administrator\AppData\Roaming\baidu`
- 说明：如不再使用百度浏览器可删除
- **预计释放：~1.51 GB**

### 5. 360浏览器数据 — 0.22 GB
- 路径：`C:\Users\Administrator\AppData\Roaming\360se6`
- 说明：如不再使用360浏览器可删除
- **预计释放：~0.22 GB**

### 6. 空文件夹/废弃目录
| 路径 | 说明 |
|------|------|
| `C:\KRECYCLE` | 金山回收站（空） |
| `C:\KDubaSoftDownloads` | 金山毒霸下载目录（空） |
| `C:\list` | 空目录 |
| `C:\bkinfo` | 空目录 |
| `C:\officeclient.microsoft.com` | Office临时缓存（77 MB） |

### 7. Python 2.7 — 极小
- 路径：`C:\Python27`
- 说明：Python 2.7 早已停止维护，通常不再需要
- **预计释放：极小，但可清理**

### 8. UC-DOS — 极小
- 路径：`C:\Ucdos`
- 说明：DOS时代的汉字系统，完全可以删除
- **预计释放：极小**

### 9. Downloads 目录清理 — 1.89 GB
- 路径：`C:\Users\Administrator\Downloads`
- 建议删除的文件：
  - `SwordAgent-windows-v1.3.3.0008-Baseline.zip` (41.3 MB) — 已解压的安装包
  - `cache.zip` (2.2 MB)
  - 多个 `.png` 截图文件
  - 其他已不需要的下载文件
- **预计释放：0.5~1.5 GB（视保留情况）**

**小计低风险可释放：约 5~6 GB**

---

## 三、建议评估后清理项（中等风险）

### 1. 通义灵码（Lingma）— 6.58 GB
- 路径：`C:\Users\Administrator\.lingma`
- 说明：阿里通义灵码 IDE 的缓存和模型数据，体积非常大
- 建议：如果不再使用通义灵码，可删除整个目录

### 2. 腾讯应用数据 — 10.40 GB
- 路径：`C:\Users\Administrator\AppData\Roaming\Tencent`

| 子目录 | 大小 | 说明 | 建议 |
|--------|------|------|------|
| xwechat | 3.09 GB | 微信缓存 | 在微信设置中清理缓存文件 |
| QQLive | 2.30 GB | 腾讯视频缓存 | 在腾讯视频设置中清理缓存 |
| WXWork | 1.46 GB | 企业微信数据 | 在企业微信设置中清理缓存 |
| WeChat | 1.04 GB | 微信PC版数据 | 在微信设置中清理缓存 |
| WeMeet | 0.94 GB | 腾讯会议缓存 | 在腾讯会议设置中清理 |
| QQ | 0.66 GB | QQ数据 | 清理聊天缓存 |
| WeGame | 0.36 GB | WeGame | 清理游戏缓存 |
| Logs | 0.31 GB | 日志 | 直接删除 |

### 3. 金山/WPS 数据 — 4.44 GB
- 路径：`C:\Users\Administrator\AppData\Roaming\kingsoft`
- 说明：WPS Office 的缓存和云文档数据
- 建议：在 WPS 设置中清理本地缓存

### 4. Google Chrome 数据 — 5.31 GB
- 路径：`C:\Users\Administrator\AppData\Local\Google\Chrome`
- 说明：Chrome 浏览器缓存约 0.33 GB，但整体数据量大
- 建议：在 Chrome 设置 → 清除浏览数据 → 清除缓存和旧数据

### 5. 游戏数据 — 约 1.7 GB
| 路径 | 大小 | 说明 |
|------|------|------|
| `AppData\Local\ForzaHorizon4` | 1.14 GB | 极限竞速4 |
| `AppData\Local\Pal` | 0.55 GB | 幻兽帕鲁 |
- 建议：如果已卸载游戏，直接删除这些残留数据

### 6. Steam 目录 — 极小
- 路径：`C:\steam`
- 说明：如果游戏库已迁移到其他盘，可删除

### 7. Playwright 浏览器 — 1.33 GB
- 路径：`C:\Users\Administrator\AppData\Local\ms-playwright`
- 说明：Playwright 自动化测试用的浏览器二进制文件
- 建议：如果暂时不用 E2E 测试，可以删除，需要时 `npx playwright install` 重新安装

### 8. pnpm 缓存 — 1.45 GB
- 路径：`C:\Users\Administrator\AppData\Local\pnpm`
- 清理命令：`pnpm store prune`
- **预计释放：0.5~1 GB**

### 9. Maven 仓库缓存 — 1.43 GB
- 路径：`C:\Users\Administrator\.m2`
- 建议：如不再做 Java 开发可删除；否则保留
- 清理命令：删除 `C:\Users\Administrator\.m2\repository` 中不需要的旧版本依赖

### 10. 多余的 JDK 版本 — 0.48 GB
- 路径：`C:\Users\Administrator\.jdks`
- 当前有 3 个版本：corretto-11.0.20.1、corretto-11.0.21、corretto-17.0.8.1
- 建议：只保留一个 11.x 和一个 17.x，删除多余的

**小计中等风险可释放：约 15~25 GB**

---

## 四、系统级清理建议

### 1. Windows 磁盘清理工具（推荐）
```
cleanmgr /d C
```
勾选以下选项：
- Windows 更新清理
- 临时文件
- 系统错误内存转储文件
- Windows 升级日志文件
- 传递优化文件
- **预计释放：2~5 GB**

### 2. Windows Installer 清理 — 14.81 GB
- 路径：`C:\WINDOWS\Installer`
- ⚠️ **不要手动删除此目录中的文件！**
- 使用工具：`patchcleaner` 或磁盘清理工具安全清理补丁冗余

### 3. WinSxS 组件存储清理 — 10.14 GB
- 以管理员身份运行：
```powershell
Dism.exe /online /Cleanup-Image /StartComponentCleanup /ResetBase
```
- **预计释放：2~4 GB**

### 4. 联想预装软件 — 约 14.5 GB
| 路径 | 大小 |
|------|------|
| `C:\Program Files (x86)\Lenovo` | 6.31 GB |
| `C:\ProgramData\Lenovo` | 5.81 GB |
| `C:\Users\Administrator\AppData\Local\Lenovo` | 2.40 GB |
| `C:\LenovoDrivers` | 0.02 GB |
| `C:\LenovoQMDownload` | 极小 |
- 建议：如不需要联想预装工具，可在"设置 → 应用"中卸载联想相关程序

---

## 五、清理优先级推荐

| 优先级 | 操作 | 预计释放 |
|--------|------|----------|
| 🔴 高 | 清空回收站 + 临时文件 | ~2 GB |
| 🔴 高 | 删除 Cursor_old、baidu、360se6 | ~3.7 GB |
| 🔴 高 | 腾讯应用缓存清理（微信/QQ/视频） | ~5 GB |
| 🔴 高 | 运行磁盘清理 + DISM 组件清理 | ~5 GB |
| 🟡 中 | 评估通义灵码是否继续使用 | ~6.6 GB |
| 🟡 中 | 清理 Chrome 缓存、WPS缓存 | ~3 GB |
| 🟡 中 | pnpm store prune + 删除旧 JDK | ~1 GB |
| 🟡 中 | 清理 Downloads 目录 | ~1 GB |
| 🟢 低 | 卸载联想预装软件 | ~14.5 GB |
| 🟢 低 | 删除游戏残留数据 | ~1.7 GB |
| 🟢 低 | 评估 Playwright/Maven 是否需要 | ~2.8 GB |

**总计预计可释放：约 35~45 GB**

---

## 六、一键清理脚本（安全项）

> 以下脚本仅包含低风险清理项，可保存为 `.bat` 文件以管理员身份运行

```batch
@echo off
echo === C盘安全清理 ===
echo.

echo [1/6] 清空回收站...
rd /s /q C:\$Recycle.Bin 2>nul

echo [2/6] 清理临时文件...
del /q /f /s "%TEMP%\*" >nul 2>&1
del /q /f /s "C:\TEMP\*" >nul 2>&1
del /q /f /s "C:\tmp\*" >nul 2>&1

echo [3/6] 删除空文件夹...
rd /s /q "C:\KRECYCLE" 2>nul
rd /s /q "C:\KDubaSoftDownloads" 2>nul
rd /s /q "C:\list" 2>nul
rd /s /q "C:\bkinfo" 2>nul

echo [4/6] 删除旧版 Cursor 数据...
rd /s /q "%APPDATA%\Cursor_old" 2>nul

echo [5/6] 删除 Adobe 临时文件...
rd /s /q "C:\adobeTemp" 2>nul
rd /s /q "C:\officeclient.microsoft.com" 2>nul

echo [6/6] 清理系统日志...
del /q /f /s "C:\Logs\*" >nul 2>&1

echo.
echo === 清理完成 ===
pause
```

---

*报告由 Claude Code 自动生成，清理前请确认不再需要的文件再删除。*
