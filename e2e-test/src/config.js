import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// 加载配置
const configPath = join(__dirname, '..', 'test-config.json')
const config = JSON.parse(readFileSync(configPath, 'utf-8'))

// 环境变量覆盖 basePath（由 AI Platform 设置页面管理）
if (process.env.E2E_DATA_DIR) {
  config.storage.basePath = process.env.E2E_DATA_DIR
}

// 确保存储目录存在
const storagePath = resolve(config.storage.basePath)
for (const sub of ['reports', 'baselines', 'runs']) {
  const dir = join(storagePath, sub)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// 生成 runId
export function generateRunId() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export { config, storagePath, __dirname }
export default config
