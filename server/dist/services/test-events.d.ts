/**
 * 全局测试事件总线
 *
 * 所有测试事件通过此单例 EventEmitter 广播，
 * 任意数量的 SSE 客户端都可以订阅。
 */
import { EventEmitter } from 'events';
export declare const testBus: EventEmitter<any>;
export type TestEventName = 'test:start' | 'test:update' | 'agent:stream' | 'test:done' | 'test:error';
export declare function subscribeSuite(suiteId: string, handler: (evt: any) => void): () => void;
//# sourceMappingURL=test-events.d.ts.map