import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * SSR / hydration 首帧返回 false（与服务器输出一致），hydration 完成后返回 true。
 * 用于把依赖访客本地时钟/时区的文案推迟到客户端接管后再渲染，避免服务器
 * （edge UTC）算出的时间残留在 DOM 里。
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
