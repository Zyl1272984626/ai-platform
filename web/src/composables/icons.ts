/**
 * 全站图标常量表 —— 统一图标定义来源
 * ====================================================================
 * 从 @vicons/ionicons5 导出项目用到的所有图标,组件里应从此处引用,
 * 避免在每个文件重复 import,也便于统一替换/维护。
 *
 * 用法:
 *   import { IconNav } from '@/composables/icons'
 *   <Icon :icon="IconNav.dashboard" />
 */
import {
  // 导航
  GridOutline,
  ChatbubblesOutline,
  SchoolOutline,
  HardwareChipOutline,
  ExtensionPuzzleOutline,
  FlaskOutline,
  RocketOutline,
  SettingsOutline,
  BookOutline,
  // 操作 / 通用
  AddOutline,
  CloseOutline,
  CheckmarkOutline,
  CheckmarkCircleOutline,
  CloseCircleOutline,
  AlertCircleOutline,
  InformationCircleOutline,
  StopOutline,
  RefreshOutline,
  SearchOutline,
  CreateOutline,
  TrashOutline,
  ArrowBackOutline,
  ChevronDownOutline,
  ChevronUpOutline,
  ChevronForwardOutline,
  ChevronBackOutline,
  EyeOutline,
  EyeOffOutline,
  // 业务
  SparklesOutline,
  LinkOutline,
  ServerOutline,
  ClipboardOutline,
  GlobeOutline,
  ChatbubbleEllipsesOutline,
  CubeOutline,
  FilterOutline,
  DocumentTextOutline,
  CodeWorkingOutline,
  PlayOutline,
  MegaphoneOutline,
  ThumbsUpOutline,
  RepeatOutline,
} from '@vicons/ionicons5'

/** 侧边栏导航图标 */
export const IconNav = {
  dashboard: GridOutline, // 总览
  task: RocketOutline,
  project: SchoolOutline,
  evidence: ClipboardOutline,
  tools: ExtensionPuzzleOutline,
  chat: ChatbubblesOutline, // 对话
  school: SchoolOutline, // 学校
  workflow: HardwareChipOutline, // 工作流
  skill: ExtensionPuzzleOutline, // Skills
  test: FlaskOutline, // 测试
  pipeline: RocketOutline, // 流水线
  memory: BookOutline, // 记忆(改用书本图标)
  settings: SettingsOutline, // 设置
}

/** 操作类图标 */
export const IconAction = {
  add: AddOutline,
  close: CloseOutline,
  edit: CreateOutline,
  delete: TrashOutline,
  refresh: RefreshOutline,
  search: SearchOutline,
  back: ArrowBackOutline,
  play: PlayOutline,
  stop: StopOutline,
  refresh2: RepeatOutline,
}

/** 反馈 / 状态类图标(toast、状态提示) */
export const IconStatus = {
  success: CheckmarkCircleOutline,
  error: CloseCircleOutline,
  warning: AlertCircleOutline,
  info: InformationCircleOutline,
  check: CheckmarkOutline,
  x: CloseOutline,
}

/** 折叠 / 展开箭头 */
export const IconArrow = {
  down: ChevronDownOutline,
  up: ChevronUpOutline,
  left: ChevronBackOutline,
  right: ChevronForwardOutline,
}

/** 业务专用图标 */
export const IconBiz = {
  sparkles: SparklesOutline, // AI / Claude
  link: LinkOutline,
  server: ServerOutline,
  robot: ChatbubbleEllipsesOutline, // 对话/助手
  thinking: SparklesOutline, // 思考中
  filter: FilterOutline,
  doc: DocumentTextOutline, // 报告 md
  clipboard: ClipboardOutline, // 报告 json
  globe: GlobeOutline, // 报告 html
  cube: CubeOutline, // 模块
  code: CodeWorkingOutline,
  deploy: ServerOutline,
  thumbsUp: ThumbsUpOutline,
}
