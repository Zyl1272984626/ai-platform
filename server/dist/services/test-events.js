"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testBus = void 0;
exports.subscribeSuite = subscribeSuite;
/**
 * 全局测试事件总线
 *
 * 所有测试事件通过此单例 EventEmitter 广播，
 * 任意数量的 SSE 客户端都可以订阅。
 */
const events_1 = require("events");
exports.testBus = new events_1.EventEmitter();
// 订阅某个 suiteId 的所有事件（返回取消订阅函数）
function subscribeSuite(suiteId, handler) {
    const events = [
        'test:start',
        'test:update',
        'agent:stream',
        'test:done',
        'test:error',
    ];
    for (const e of events) {
        exports.testBus.on(e, handler);
    }
    return () => {
        for (const e of events) {
            exports.testBus.off(e, handler);
        }
    };
}
//# sourceMappingURL=test-events.js.map