import { useLayoutEffect, useRef, useState } from "react";

type OverflowMarqueeProps = {
  text: string;
  className?: string;
  /** 顶栏标题：静止时尾部省略号，hover 再慢速滚动全文。 */
  endEllipsis?: boolean;
};

/** 按字数拉长周期，长标题不会一闪而过。 */
export function marqueeDurationSec(text: string) {
  return Math.min(40, Math.max(18, Array.from(text).length * 0.32));
}

/**
 * 会话名跑马灯。视口锁 width:100%。
 * 顶栏标题用 endEllipsis：先看到尾部 …，悬停后慢速走马灯。
 */
export function OverflowMarquee({
  text,
  className = "",
  endEllipsis = false,
}: OverflowMarqueeProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const full = measureRef.current;
    if (!viewport || !full) return;

    const measure = () => {
      // 测宽节点不能 display:none，否则溢出判定会在省略态来回抖动。
      setOverflow(full.scrollWidth > viewport.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(full);
    return () => observer.disconnect();
  }, [text]);

  const state = [
    overflow ? "is-overflow" : "",
    endEllipsis ? "is-ellipsis" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={`overflow-marquee ${state} ${className}`.trim()}
      ref={viewportRef}
      style={
        overflow
          ? { ["--marquee-duration" as string]: `${marqueeDurationSec(text)}s` }
          : undefined
      }
      title={overflow ? text : undefined}
    >
      <span
        aria-hidden="true"
        className="overflow-marquee-measure"
        ref={measureRef}
      >
        {text}
      </span>
      {endEllipsis && <span className="overflow-marquee-ellipsis">{text}</span>}
      <span className="overflow-marquee-track">
        <span className="overflow-marquee-text">{text}</span>
        {overflow && (
          <span aria-hidden="true" className="overflow-marquee-text">
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
