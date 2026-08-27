import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { marqueeDurationSec, OverflowMarquee } from "./OverflowMarquee";

describe("OverflowMarquee", () => {
  const title =
    "你好12345/Users/qiusen/workspace/suna/Users/qiusen/workspace/suna";

  it("会话名渲染全文", () => {
    render(<OverflowMarquee text={title} />);
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  });

  it("顶栏标题带尾部省略模式", () => {
    const { container } = render(<OverflowMarquee endEllipsis text={title} />);
    expect(container.querySelector(".is-ellipsis")).toBeTruthy();
    expect(container.querySelector(".overflow-marquee-ellipsis")).toBeTruthy();
  });

  it("长标题跑马灯周期更慢", () => {
    expect(marqueeDurationSec("短标题")).toBe(18);
    expect(marqueeDurationSec(title)).toBeGreaterThan(18);
  });
});
