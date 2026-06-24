/**
 * naive-ui 主题覆盖
 * ====================================================================
 * 将 naive-ui 组件库的全局主题对齐到本项目的设计令牌(紫蓝主色 #667eea)。
 * 在 App.vue 根部通过 <n-config-provider :theme-overrides="themeOverrides"> 注入。
 *
 * 文档:https://www.naiveui.com/zh-CN/os-theme/docs/customize-theme
 */
import type { GlobalThemeOverrides } from 'naive-ui'

export const themeOverrides: GlobalThemeOverrides = {
  common: {
    // 品牌色
    primaryColor: '#667eea',
    primaryColorHover: '#5a6fd6',
    primaryColorPressed: '#4f62c2',
    primaryColorSuppl: '#667eea',

    // 信息色
    infoColor: '#1890ff',
    infoColorHover: '#40a9ff',
    infoColorPressed: '#096dd9',
    successColor: '#52c41a',
    successColorHover: '#73d13d',
    successColorPressed: '#389e0d',
    warningColor: '#faad14',
    warningColorHover: '#ffc53d',
    warningColorPressed: '#d48806',
    errorColor: '#ff4d4f',
    errorColorHover: '#ff7875',
    errorColorPressed: '#d9363e',

    // 文字与边框(对齐 token)
    textColorBase: '#1a1a2e',
    bodyColor: '#f0f2f5',
    borderColor: '#e8e8e8',

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
    borderHover: '1px solid #667eea',
    borderFocus: '1px solid #667eea',
    boxShadowFocus: '0 0 0 2px rgba(102, 126, 234, 0.15)',
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
