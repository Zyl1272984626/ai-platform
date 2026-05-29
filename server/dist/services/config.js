"use strict";
/**
 * 全局配置常量
 * 独立模块，避免循环依赖
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_PLATFORM_ROOT = exports.PROJECT_ROOT = void 0;
/** 主系统工作目录 */
exports.PROJECT_ROOT = process.env.PROJECT_ROOT || 'C:/FengSuKeJi/agent';
/** AI Platform 数据根目录 */
exports.AI_PLATFORM_ROOT = process.env.AI_PLATFORM_ROOT || 'C:/FengSuKeJi/ai-platform';
//# sourceMappingURL=config.js.map