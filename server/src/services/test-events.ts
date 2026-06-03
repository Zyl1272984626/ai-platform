/**
 * 全局测试事件总线
 *
 * 所有测试事件通过此单例 EventEmitter 广播，
 * 任意数量的 SSE 客户端都可以订阅。
 */
import { EventEmitter } from 'events';

export const testBus = new EventEmitter();

// 事件类型
export type TestEventName =
  | 'test:start'
  | 'test:update'
  | 'agent:stream'
  | 'test:done'
  | 'test:error'
  | 'test:resumed'
  | 'agent:chat';

// 订阅某个 suiteId 的所有事件（返回取消订阅函数）
export function subscribeSuite(
  suiteId: string,
  handler: (evt: any) => void
): () => void {
  const events: TestEventName[] = [
    'test:start',
    'test:update',
    'agent:stream',
    'test:done',
    'test:error',
  ];
  for (const e of events) {
    testBus.on(e, handler);
  }
  return () => {
    for (const e of events) {
      testBus.off(e, handler);
    }
  };
}
