import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ActiveData, Scope } from "./sessionState";

type DeltaQueueDeps = {
  setActive: Dispatch<SetStateAction<ActiveData>>;
  /** 读取当前 attach 作用域（scopeRef.current）。 */
  getScope: () => Scope | undefined;
  /** 更新当前 attach 作用域（首次收到 run_id 时绑定）。 */
  setScope: (scope: Scope) => void;
  /** 是否处于会话切换/同步边界（同步中丢弃 delta）。 */
  isSyncing: () => boolean;
};

/**
 * 流式 delta 批处理：按到达顺序缓冲 assistant/reasoning 增量，
 * 用 requestAnimationFrame 合并到一帧，避免 token 级全页渲染。
 * 与末尾同 kind 且未结束的段合并，否则新开一段（思考→工具→回复可交替）。
 */
export function useDeltaQueue({
  setActive,
  getScope,
  setScope,
  isSyncing,
}: DeltaQueueDeps) {
  const deltaRef = useRef({
    items: [] as { kind: "assistant" | "reasoning"; content: string }[],
    scope: undefined as Scope | undefined,
  });
  const deltaFrameRef = useRef<number | undefined>(undefined);
  const flowIdRef = useRef(0);

  const resetQueuedDeltas = useCallback(() => {
    if (deltaFrameRef.current !== undefined)
      cancelAnimationFrame(deltaFrameRef.current);
    deltaFrameRef.current = undefined;
    deltaRef.current = { items: [], scope: undefined };
  }, []);

  const flushDeltas = useCallback(() => {
    deltaFrameRef.current = undefined;
    const pending = deltaRef.current;
    deltaRef.current = { items: [], scope: undefined };
    const scope = getScope();
    if (
      pending.items.length === 0 ||
      isSyncing() ||
      !scope ||
      !pending.scope ||
      scope.attach !== pending.scope.attach ||
      scope.sessionId !== pending.scope.sessionId ||
      scope.runId !== pending.scope.runId
    )
      return;
    // 把到达顺序的 delta 逐段写入统一叙事流：与末尾同 kind 且未结束的段
    // 合并（继续流式累积），否则新开一段——思考→工具→回复可交替出现。
    setActive((value) => {
      const flow = [...value.flow];
      for (const item of pending.items) {
        const last = flow[flow.length - 1];
        if (
          last &&
          last.kind === item.kind &&
          !last.done &&
          (last.kind === "assistant" || last.kind === "reasoning")
        ) {
          flow[flow.length - 1] = { ...last, text: last.text + item.content };
        } else {
          flow.push({
            kind: item.kind,
            id: ++flowIdRef.current,
            text: item.content,
            done: false,
          });
        }
      }
      return { ...value, flow };
    });
  }, [getScope, isSyncing, setActive]);

  const queueDelta = useCallback(
    (kind: "assistant" | "reasoning", content: string, runId?: string) => {
      const scope = getScope();
      // RuntimeEvents 已先按 session_id 过滤；delta 本身可不带 run_id。
      // 带 run_id 时仍要拒绝旧 run，首次收到时建立当前 run 作用域。
      if (isSyncing() || !scope) return;
      if (runId && scope.runId && scope.runId !== runId) return;
      // 首次收到 run_id 时建立权威作用域：setScope 更新外部状态，
      // pending scope 必须使用更新后的值，否则 flush 时新旧 runId 不匹配，
      // 第一条 delta 会被整批丢弃。
      let pendingScope = scope;
      if (runId && !scope.runId) {
        pendingScope = { ...scope, runId };
        setScope(pendingScope);
      }
      if (
        deltaRef.current.scope &&
        deltaRef.current.scope.attach !== pendingScope.attach
      )
        resetQueuedDeltas();
      deltaRef.current.scope = { ...pendingScope };
      deltaRef.current.items.push({ kind, content });
      if (deltaFrameRef.current === undefined)
        deltaFrameRef.current = requestAnimationFrame(flushDeltas);
    },
    [flushDeltas, getScope, isSyncing, resetQueuedDeltas, setScope],
  );

  useEffect(
    () => () => {
      resetQueuedDeltas();
    },
    [resetQueuedDeltas],
  );

  return { queueDelta, flushDeltas, resetQueuedDeltas };
}
