/**
 * naive-ui 主题覆盖
 * ====================================================================
 * 将 naive-ui 组件库的全局主题对齐到本项目的设计令牌(indigo 主色 #6366f1)。
 * 在 App.vue 根部通过 <n-config-provider :theme-overrides="themeOverrides"> 注入。
 *
 * 文档:https://www.naiveui.com/zh-CN/os-theme/docs/customize-theme
 */
import type { GlobalThemeOverrides } from 'naive-ui'

export const themeOverrides: GlobalThemeOverrides = {
  common: {
    // 品牌色(indigo 系,对齐 token)
    primaryColor: '#6366f1',
    primaryColorHover: '#5558e3',
    primaryColorPressed: '#4f46e5',
    primaryColorSuppl: '#6366f1',

    // 语义色(对齐 token 的现代调色板)
    infoColor: '#0ea5e9',
    infoColorHover: '#38bdf8',
    infoColorPressed: '#0284c7',
    successColor: '#10b981',
    successColorHover: '#34d399',
    successColorPressed: '#059669',
    warningColor: '#f59e0b',
    warningColorHover: '#fbbf24',
    warningColorPressed: '#d97706',
    errorColor: '#ef4444',
    errorColorHover: '#f87171',
    errorColorPressed: '#dc2626',

    // 文字与边框(对齐 slate 灰阶)
    textColorBase: '#0f172a',
    textColor1: '#0f172a',
    textColor2: '#334155',
    textColor3: '#64748b',
    bodyColor: '#f8fafc',
    borderColor: '#e2e8f0',
    dividerColor: '#f1f5f9',

    // 圆角
    borderRadius: '8px',
    borderRadiusSmall: '6px',

    // 字体
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontFamilyMono:
      "'JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', monospace",
  },

  Button: {
    // 主按钮用纯色而非渐变,文字更清晰
    fontWeight: '500',
    borderRadiusMedium: '8px',
    borderRadiusSmall: '6px',
  },

  Card: {
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },

  Input: {
    borderRadius: '8px',
    borderHover: '1px solid #6366f1',
    borderFocus: '1px solid #6366f1',
    boxShadowFocus: '0 0 0 2px rgba(99, 102, 241, 0.15)',
  },

  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '8px',
      },
    },
  },

  Modal: {
    borderRadius: '12px',
  },

  Tag: {
    borderRadius: '6px',
  },
}
