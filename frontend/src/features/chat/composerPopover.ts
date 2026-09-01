import { useLayoutEffect, useState, type RefObject } from "react";

type Placement = "above" | "below";

const VIEWPORT_GUTTER = 12;
const ANCHOR_GAP = 8;

export function composerPopoverPlacement(
  anchor: Pick<DOMRect, "top" | "bottom">,
  viewportHeight: number,
  preferredMaxHeight: number,
) {
  const above = Math.max(0, anchor.top - VIEWPORT_GUTTER - ANCHOR_GAP);
  const below = Math.max(
    0,
    viewportHeight - anchor.bottom - VIEWPORT_GUTTER - ANCHOR_GAP,
  );
  const placement: Placement = below > above ? "below" : "above";
  const availableHeight = placement === "above" ? above : below;

  return {
    placement,
    maxHeight: Math.min(preferredMaxHeight, availableHeight),
  };
}

/** 根据输入框在视口中的位置，决定菜单向上或向下展开。 */
export function useComposerPopoverPlacement(
  ref: RefObject<HTMLElement | null>,
  preferredMaxHeight: number,
) {
  const [position, setPosition] = useState(() => ({
    placement: "above" as Placement,
    maxHeight: preferredMaxHeight,
  }));

  useLayoutEffect(() => {
    const anchor = ref.current?.parentElement;
    if (!anchor) return;

    const update = () => {
      setPosition(
        composerPopoverPlacement(
          anchor.getBoundingClientRect(),
          window.innerHeight,
          preferredMaxHeight,
        ),
      );
    };

    update();
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(anchor);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [preferredMaxHeight, ref]);

  return {
    className:
      position.placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
    style: { maxHeight: `${position.maxHeight}px` },
  };
}
