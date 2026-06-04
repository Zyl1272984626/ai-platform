# API 安全与加密封装模块 - 深度代码审查报告

| 属性 | 值 |
|------|-----|
| 审查日期 | 2026-06-03 |
| 模块路径 | `frontend/src/api/` |
| 文件数量 | 17 |
| 风险等级 | **High** |
| 前端框架 | Vue 3 + Vite + Pinia |
| 综合评分 | **42 / 100** |

---

## 一、问题列表

### 1.1 安全性 (Critical)

#### SEC-001 | RSA 公钥硬编码在前端源码中
| 属性 | 值 |
|------|-----|
| 严重等级 | **Critical** |
| 规则ID | SEC002 |
| 文件路径 | `frontend/src/api/axios/security/constant.js` 第 5 行 |
| 影响范围 | 全部加密流程 |

**问题描述：**
RSA 2048-bit 公钥以明文字符串形式硬编码在 JavaScript 源码中。虽然 RSA 公钥本身可以公开，但前端硬编码意味着密钥无法轮换（必须重新发布前端），且攻击者可以确认所使用的加密方案和密钥，缩小攻击面。

```javascript
export const rsaPublicKey = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7GN2i...";
```

**修复建议：**
- 将公钥通过后端接口动态获取，并支持密钥版本号
- 前端缓存公钥，设置合理的过期时间（如 24 小时）
- 后端支持密钥轮换机制，通过版本号平滑过渡

---

#### SEC-002 | AES 使用 ECB 模式
| 属性 | 值 |
|------|-----|
| 严重等级 | **Critical** |
| 规则ID | SEC003 |
| 文件路径 | `frontend/src/api/axios/security/aes.js` 第 15、25 行 |
| 影响范围 | 全部 POST/GET 请求数据加密 |

**问题描述：**
AES 加密使用了 ECB (Electronic Codebook) 模式。ECB 模式是最不安全的分组加密模式：相同的明文块总是产生相同的密文块，导致攻击者可以通过模式分析推断数据内容。且代码中 decrypt 方法声明了 `iv: key` 但实际 ECB 模式不使用 IV，属于错误的自相矛盾。

```javascript
// 加密
var encrypted = CryptoJS.AES.encrypt(srcs, key, {
  mode: CryptoJS.mode.ECB,   // 不安全的 ECB 模式
  padding: CryptoJS.pad.Pkcs7
});
// 解密 - 错误地设置了 iv 但 ECB 不使用 IV
var decrypt = CryptoJS.AES.decrypt(word, key, {
  iv: key,                    // ECB 模式下无效，且 key 作为 IV 不安全
  mode: CryptoJS.mode.ECB,
  padding: CryptoJS.pad.Pkcs7
});
```

**修复建议：**
- 替换为 CBC 或 GCM 模式。推荐 GCM 模式（提供认证加密）
- 使用随机生成的 IV，每次加密操作使用不同的 IV
- IV 随密文一起传输（IV 不需要保密）
- 需要后端同步配合修改

---

#### SEC-003 | isProd 硬编码为 false 导致加密失效
| 属性 | 值 |
|------|-----|
| 严重等级 | **Critical** |
| 规则ID | SEC002 / SEC003 |
| 文件路径 | `frontend/src/api/request.ts` 第 10 行 |
| 影响范围 | 通过 request.ts 发出的所有请求在开发环境以明文传输 |

**问题描述：**
`request.ts`（主入口之一）中 `isProd` 被硬编码为 `false`，这意味着即使部署到生产环境，通过此入口发出的所有请求也不会加密。同样的问题存在于 `axios/request3.js`（第 5 行）。

```typescript
// request.ts 第 10 行
let isProd: boolean = false;  // 硬编码！永远不加密

// request3.js 第 5 行
let isProd = false;  // 同样硬编码
```

相比之下，`axios/config.ts` 和 `security/constant.js` 正确使用了环境变量判断。

**修复建议：**
- 统一使用 `import.meta.env.MODE === 'production'` 或从 `constant.js` 导入
- 删除 `request3.js`（废弃的旧版本），避免维护多套配置

---

#### SEC-004 | Token 通过 URL 参数传递
| 属性 | 值 |
|------|-----|
| 严重等级 | **High** |
| 规则ID | SEC004 |
| 文件路径 | `frontend/src/api/axios/config.ts` 第 17 行 |
| 影响范围 | 所有 API 请求的认证机制 |

**问题描述：**
Token 优先从 URL 查询参数中获取，这会导致：
1. Token 出现在浏览器地址栏，可被肉眼看到
2. Token 被记录在浏览器历史记录中
3. Token 可能被 Referer 头泄露给第三方站点
4. Token 可能被服务器访问日志记录

```typescript
const token = getParam("token");  // 从 URL ?token=xxx 获取
if(token){
  headers.token = token;
} else {
  // 回退到 localStorage
  const storedToken = window?.localStorage?.getItem('token');
}
```

此外，token 存储在 localStorage 中也有 XSS 攻击窃取风险。

**修复建议：**
- 禁止通过 URL 参数传递 token，改用 HttpOnly Cookie
- 如果必须支持外部链接带 token 认证，应该在页面加载时立即从 URL 提取 token、验证后存入 session，并从 URL 中移除
- token 应存储在 sessionStorage（关闭即失效）而非 localStorage（持久化风险更大）
- 长期方案：使用 HttpOnly + Secure + SameSite Cookie，彻底消除前端 JavaScript 接触 token 的可能

---

#### SEC-005 | dangerouslyUseHTMLString 用于渲染错误消息
| 属性 | 值 |
|------|-----|
| 严重等级 | **High** |
| 规则ID | SEC001 |
| 文件路径 | `frontend/src/api/axios/config.ts` 第 127-133 行 |
| 影响范围 | 所有 API 错误消息的展示 |

**问题描述：**
错误消息使用 `dangerouslyUseHTMLString: true` 直接作为 HTML 渲染，且消息内容包含来自服务端的 `errorMsg` 和 `url`，均未经任何净化处理。如果服务端返回的消息被注入恶意脚本（存储型 XSS 或服务端被入侵），将导致 XSS 攻击。

```typescript
if (errorMsg) message = `<p>${errorMsg}!</p>`;
if (url) message += `<p>出错接口：${url}</p>`;
ElNotification({
  dangerouslyUseHTMLString: true,
  message: message,
});
```

同样的问题也存在于 `config2.js` 第 92-98 行。

**修复建议：**
- 移除 `dangerouslyUseHTMLString`，使用纯文本渲染
- 如果确实需要格式化，使用 DOMPurify 对内容进行净化
- 对 `errorMsg` 和 `url` 进行 HTML 实体转义

---

#### SEC-006 | 服务端响应头控制前端重定向，未验证目标 URL
| 属性 | 值 |
|------|-----|
| 严重等级 | **High** |
| 规则ID | SEC007 |
| 文件路径 | `frontend/src/api/axios/config.ts` 第 74-76 行 |
| 影响范围 | 全局 axios 响应拦截器 |

**问题描述：**
当服务端响应头中包含 `redirect` 字段时，前端直接将 `headers['content-path']` 赋值给 `location.href` 进行跳转，未对目标 URL 进行任何白名单校验。如果服务端响应被篡改（中间人攻击或服务端漏洞），可能导致开放重定向。

```typescript
if (headers['redirect']) {
  location.href = headers['content-path'];  // 未校验目标 URL
}
```

在 `interceptors/admin.js` 中存在同样的问题（第 24、28 行）。

**修复建议：**
- 实现 URL 白名单校验，只允许跳转到本域名或已授权的域名
- 使用 URL 对象解析目标地址，验证 hostname

---

#### SEC-007 | AES 密钥在内存中无限累积
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | SEC003 / PERF001 |
| 文件路径 | `frontend/src/api/axios/security/axios-handler.js` 第 3、23 行 |
| 影响范围 | 长时间运行的单页应用 |

**问题描述：**
`aesKeyHash` 对象在模块加载时创建，每次请求都会向其中添加一个 AES 密钥条目，但从未清理。长时间运行后，内存中会累积大量密钥数据，既造成内存泄漏，也增加了密钥被从内存中提取的风险。

```javascript
let aesKeyHash = {};
// ...
aesKeyHash[encrypt.rsaAesKey] = encrypt.aesKey;  // 只存不删
```

**修复建议：**
- 在响应解密后立即删除对应的密钥条目：`delete aesKeyHash[config.headers['tk']]`
- 或使用 LRU 缓存，设置最大条目数（如 50）

---

### 1.2 性能 (High)

#### PERF-001 | setTimeout 创建的定时器未正确清理
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | PERF001 |
| 文件路径 | `frontend/src/api/axios/config.ts` 第 96-101 行 |
| 影响范围 | 错误通知的展示 |

**问题描述：**
代码使用 `clearTimeout(timer)` 后立即创建新的 `setTimeout`，设计意图是防抖（debounce），但 10ms 的延迟极短，无法起到防抖效果。且在页面卸载时没有清理残留定时器。

**修复建议：**
- 使用标准的 debounce 函数替代手写的 setTimeout 逻辑
- 在页面/组件销毁时清理定时器

---

#### PERF-002 | request.ts 中 isProd = false 导致 baseURL 永远走代理路径
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | SEC003 |
| 文件路径 | `frontend/src/api/request.ts` 第 79-87 行 |
| 影响范围 | 所有通过 serviceApi 发出的请求路径 |

**问题描述：**
由于 `isProd = false`（硬编码），`getBase()` 方法永远返回 `service`（即 `APPLICATION_NAME = ""`），不会走 `../` 相对路径。这意味着即使在生产环境构建，API 路径也不会正确。

**修复建议：**
- 与 SEC-003 一并修复，统一使用环境变量

---

### 1.3 错误处理 (High)

#### ERR-001 | 响应拦截器成功回调缺少 return
| 属性 | 值 |
|------|-----|
| 严重等级 | **High** |
| 规则ID | ERR001 |
| 文件路径 | `frontend/src/api/axios/config.ts` 第 70-71 行、第 74-76 行 |
| 影响范围 | 会话超时和重定向场景 |

**问题描述：**
当 `sessionstatus === 'timeout'` 或存在 `redirect` 头时，代码执行 `location.reload()` 或 `location.href = ...` 后直接 `return;`（无返回值），导致调用方收到 `undefined` 而非 Promise rejection，可能引发后续的 `Cannot read property of undefined` 错误。

```typescript
if (headers && headers.sessionstatus === 'timeout') {
  location.reload();
  return;  // 返回 undefined，不是 Promise.reject
}
```

**修复建议：**
- 改为 `return Promise.reject(new Error('会话超时'))` 或返回一个 pending Promise
- 在重定向前给调用方一个明确的拒绝信号

---

#### ERR-002 | httpErrorStatusHandle 缺少空值保护
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | ERR002 |
| 文件路径 | `frontend/src/api/axios/config.ts` 第 145-173 行 |
| 影响范围 | 错误处理流程 |

**问题描述：**
`httpErrorStatusHandle` 函数中解构 `response` 时，如果 `error.response` 为 `undefined`（如网络断开），第 147 行的 `let { status } = response` 会抛出 TypeError。

```typescript
function httpErrorStatusHandle(error: AxiosError): string {
  let {response, message:errorMessage} = error;
  let { status } = response as { status: number };  // response 可能为 undefined
```

**修复建议：**
- 在解构前检查 `response` 是否存在
- `let { status } = response || { status: 0 }`

---

#### ERR-003 | JSON.parse 解密后未充分处理异常
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | ERR003 |
| 文件路径 | `frontend/src/api/axios/security/axios-handler.js` 第 41-44 行 |

**问题描述：**
解密后的数据使用 try-catch 包裹 JSON.parse，但 catch 块中直接赋值 `response.data.data = data`，没有区分"合法的非 JSON 数据"和"解密失败导致的乱码"。

```javascript
try{
  response.data.data = JSON.parse(data);
}catch (e){
  response.data.data = data;  // 解密失败的乱码也会被赋值
}
```

**修复建议：**
- 在 catch 中检查 data 是否为有效的非 JSON 值（如纯字符串、数字）
- 对于解密失败的情况，记录错误日志并返回友好的错误信息

---

#### ERR-004 | download 方法缺少 try-catch
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | ERR001 |
| 文件路径 | `frontend/src/api/request.ts` 第 148-177 行 |
| 影响范围 | 文件下载功能 |

**问题描述：**
`download` 方法使用 `async/await` 但没有 try-catch 保护。如果请求失败或 Blob 创建失败，异常会直接抛出到调用方。且 Object URL 未在 finally 中释放（`URL.revokeObjectURL`），可能导致浏览器内存泄漏。

**修复建议：**
- 添加 try-catch 包裹整个下载逻辑
- 在 finally 中调用 `URL.revokeObjectURL(downloadUrl)` 释放 Object URL
- 在 catch 中清理已创建的 DOM 元素

---

### 1.4 框架最佳实践 (Medium)

#### FW-001 | request.ts 仍暴露 delete 方法（违反项目规范）
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | FW005 / 项目规范 |
| 文件路径 | `frontend/src/api/request.ts` 第 60-65 行、第 135-137 行 |
| 影响范围 | API 调用规范 |

**问题描述：**
项目规范明确规定"HTTP 接口请求类型只能为 POST 或 GET，不使用 PUT/DELETE"，但 `serviceApi` 和 `api` 对象仍然暴露了 `delete` 方法。

**修复建议：**
- 移除 `delete` 方法
- 如需删除操作，统一使用 POST + 路径区分（如 `/xxx/delete`）

---

#### FW-002 | TypeScript 和 JavaScript 混用
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | FW004 |
| 文件路径 | 整个 `api/` 目录 |
| 影响范围 | 类型安全、代码一致性 |

**问题描述：**
同一模块中 `.ts` 和 `.js` 文件混用。安全核心文件（aes.js、rsa.js、security-flow.js、axios-handler.js）均为 JavaScript，没有类型标注；而外层 request.ts、config.ts、user.ts 等使用了 TypeScript。这导致：
1. 类型安全在 JS 文件处断裂
2. IDE 智能提示缺失
3. 大量使用 `any` 类型（如 request.ts 中所有 `params?: any`）

**修复建议：**
- 将安全模块的 `.js` 文件迁移为 `.ts`，补充接口类型定义
- 减少 `any` 使用，为 API 方法定义具体的请求/响应类型

---

#### FW-003 | 存在多个废弃/重复的配置文件
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | MNT001 |
| 文件路径 | `config2.js`、`request3.js` |
| 影响范围 | 代码可维护性 |

**问题描述：**
目录中存在三套 axios 配置（`config.ts`、`config2.js`、`request3.js`），其中 `config2.js` 和 `request3.js` 均使用硬编码 `isProd = false`，属于废弃代码但未清理。`config2.js` 还引用了未定义的 `loading` 全局变量。

**修复建议：**
- 确认 `config2.js` 和 `request3.js` 无引用后删除
- 保留 `config.ts` 作为唯一的 axios 实例配置

---

#### FW-004 | aes.js 中参数名遮蔽
| 属性 | 值 |
|------|-----|
| 严重等级 | **Low** |
| 规则ID | FW004 |
| 文件路径 | `frontend/src/api/axios/security/aes.js` 第 12-13 行、第 23-24 行 |

**问题描述：**
`encrypt` 和 `decrypt` 方法的参数名 `key` 与函数内部使用 `var key = ...` 重新声明了同名变量，造成参数遮蔽（parameter shadowing）。虽然功能上不影响（因为立即被覆盖），但降低可读性，且在严格模式下可能报错。

```javascript
encrypt(key, word) {
  var key = CryptoJS.enc.Utf8.parse(key);  // 遮蔽参数 key
```

**修复建议：**
- 将内部变量命名为 `parsedKey` 或 `keyBytes`

---

### 1.5 可维护性 (Medium)

#### MNT-001 | config2.js 和 config.ts 大量重复代码
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | MNT001 |
| 文件路径 | `frontend/src/api/axios/config2.js` 全文 vs `config.ts` 全文 |
| 影响范围 | 维护成本 |

**问题描述：**
`config2.js` 和 `config.ts` 的代码结构几乎完全相同（axios 实例创建、拦截器、错误处理函数），属于典型的代码克隆。修改一处时容易遗漏另一处。

**修复建议：**
- 删除 `config2.js`，统一使用 `config.ts`

---

#### MNT-002 | console.error 用于业务逻辑返回值
| 属性 | 值 |
|------|-----|
| 严重等级 | **Low** |
| 规则ID | MNT003 |
| 文件路径 | `frontend/src/api/axios/config2.js` 第 113 行 |

**问题描述：**
`httpErrorStatusHandle` 中使用 `return console.error(...)` 作为函数返回值，`console.error` 返回 `undefined`，导致该分支返回 `undefined` 而非有意义的字符串。在主配置 `config.ts` 中已修正为返回字符串。

**修复建议：**
- 删除 `config2.js` 即可解决

---

#### MNT-003 | localCode.js 中 api 未导入
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | ERR001 |
| 文件路径 | `frontend/src/api/localCode.js` 第 13 行 |

**问题描述：**
`localCode.js` 使用了 `api.post(...)` 和 `api.get(...)`，但文件顶部没有 import `api` 的语句。这会导致运行时错误 `ReferenceError: api is not defined`。

**修复建议：**
- 添加 `import { api } from './request'`
- 或确认该文件是否已废弃，如废弃则删除

---

#### MNT-004 | isProd 判断逻辑不统一
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | MNT004 |
| 文件路径 | 多文件 |
| 影响范围 | 环境判断一致性 |

**问题描述：**
模块中至少存在四种 `isProd` 的判断方式：
1. `import.meta.env.MODE === 'production'`（config.ts、config2.js）
2. `process.env.NODE_ENV === 'production'`（constant.js）
3. `let isProd = false` 硬编码（request.ts、request3.js）
4. 从 constant.js 导入（axios-handler.js、security-flow.js）

方法 1 和 2 在 Vite 构建下结果一致，但方法 3 完全错误。

**修复建议：**
- 统一从 `constant.js` 导入 `isProd`
- `constant.js` 中统一使用 `import.meta.env.MODE === 'production'`（Vite 推荐）

---

#### MNT-005 | upload 方法无文件类型和大小校验
| 属性 | 值 |
|------|-----|
| 严重等级 | **Medium** |
| 规则ID | SEC006 |
| 文件路径 | `frontend/src/api/request.ts` 第 67-75 行 |

**问题描述：**
`upload` 方法直接将 params 全部放入 FormData，没有任何前端校验（文件类型、大小、扩展名）。虽然服务端应做最终校验，但前端缺少基本的防护会增加不必要的服务端请求。

**修复建议：**
- 在 upload 方法中增加可选的校验配置（允许的 MIME 类型、最大文件大小）
- 或在调用层提供校验工具函数

---

## 二、规则覆盖情况表

| 规则ID | 规则名称 | 检查结果 | 发现问题数 |
|--------|----------|----------|-----------|
| SEC001 | XSS / HTML 注入 | **未通过** | 1（dangerouslyUseHTMLString） |
| SEC002 | 硬编码密钥/凭证 | **未通过** | 2（RSA 公钥硬编码、isProd 硬编码 false） |
| SEC003 | 加密模式/算法 | **未通过** | 1（AES ECB 模式） |
| SEC004 | Token 传输安全 | **未通过** | 1（URL 参数 + localStorage） |
| SEC005 | SSE 认证 | **通过** | 0（本模块无 SSE 相关代码） |
| SEC006 | 文件上传校验 | **待改进** | 1（无文件类型/大小校验） |
| SEC007 | 重定向安全 | **未通过** | 1（未验证重定向目标 URL） |
| PERF001 | 定时器/事件清理 | **待改进** | 1（防抖逻辑不规范） |
| PERF002 | 列表虚拟滚动 | **不适用** | 0（本模块无列表渲染） |
| PERF003 | ECharts 实例 | **不适用** | 0（本模块无图表） |
| PERF004 | 深度监听 | **不适用** | 0（本模块无 watch） |
| PERF005 | SSE 资源管理 | **不适用** | 0（本模块无 SSE） |
| ERR001 | try-catch 异常处理 | **未通过** | 2（download 无 try-catch、响应拦截器 return 缺失） |
| ERR002 | 空值保护 | **未通过** | 1（httpErrorStatusHandle 解构未防护） |
| ERR003 | JSON.parse 异常 | **待改进** | 1（catch 块未区分合法值与乱码） |
| ERR004 | 全局异常捕获 | **通过** | 0（通过 axios 拦截器统一处理） |
| ERR005 | 上传下载错误恢复 | **未通过** | 1（download 无错误处理、Object URL 未释放） |
| FW001 | Composition API | **不适用** | 0（本模块为纯 JS/TS 工具层） |
| FW002 | 状态管理 | **通过** | 0（state.ts 使用简单对象，无 Pinia 依赖） |
| FW003 | 组件通信 | **不适用** | 0（非组件） |
| FW004 | TypeScript 类型安全 | **未通过** | 2（JS/TS 混用、大量 any） |
| FW005 | 路由守卫/规范 | **未通过** | 1（暴露 delete 方法违反项目规范） |
| MNT001 | 重复逻辑 | **未通过** | 1（config2.js 克隆 config.ts） |
| MNT002 | 函数/组件复杂度 | **通过** | 0（函数长度合理） |
| MNT003 | console 日志清理 | **通过** | 1（仅 config2.js 一处，属于废弃代码） |
| MNT004 | 硬编码常量 | **未通过** | 1（isProd 判断方式不统一） |
| MNT005 | 模块职责 | **未通过** | 1（存在废弃文件未清理） |

---

## 三、总结

### 亮点
1. **加密架构设计合理**：采用"动态 AES 密钥 + RSA 加密传输 AES 密钥"的混合加密方案，是业界标准做法
2. **请求拦截器统一处理加密/解密**：通过 axios 拦截器透明化加解密逻辑，业务层无需关心加密细节
3. **文件上传自动跳过加密**：正确识别 FormData 并跳过加密，避免大文件加密的性能问题
4. **getBase 路径适配**：通过环境变量动态切换开发代理和生产相对路径
5. **Permission 模块设计清晰**：`permiss.ts` 的菜单权限校验逻辑封装合理

### 需改进（按优先级排序）
1. **[Critical] AES ECB 模式必须替换为 GCM/CBC**：这是最紧急的安全修复，ECB 模式在密码学上已被证明不安全
2. **[Critical] isProd 硬编码 false 必须修复**：导致通过 request.ts 入口的请求在生产环境也不加密
3. **[Critical] dangerouslyUseHTMLString 必须移除**：存在 XSS 风险
4. **[High] Token 传输方式需重构**：URL 参数传 token 存在多种泄露风险
5. **[High] 清理废弃文件**：config2.js、request3.js、localCode.js 等废弃代码应删除
6. **[High] 统一 isProd 判断来源**：当前四种判断方式极易出错
7. **[Medium] 安全模块 JS 转 TS**：提升类型安全和 IDE 支持
8. **[Medium] AES 密钥内存泄漏**：解密后应清理密钥
9. **[Medium] 重定向目标 URL 需白名单校验**：防止开放重定向攻击
10. **[Medium] 移除 delete 方法**：符合项目 HTTP 方法规范
