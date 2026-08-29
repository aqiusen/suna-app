import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";

type SessionStatusBarsProps = {
  error?: string;
  onCloseError: () => void;
};

/**
 * 工作区状态条：仅展示明确错误。运行/控制权由 Runtime 操作结果仲裁。
 * 作为 workspace 的独立 grid 行渲染，滚动内容不会与其重叠。
 */
export function SessionStatusBars({
  error,
  onCloseError,
}: SessionStatusBarsProps) {
  const t = useT();
  // 无论是否有提示都渲染占位 div：workspace 是 4 行 grid
  // （header / 状态条 / 时间线 / 输入区），若状态条缺位，时间线会落到
  // auto 行、输入区落到 1fr 行被拉伸/压扁，长会话下输入框会消失。
  return (
    <div className={!error ? "min-h-0" : undefined}>
      {error && (
        <div
          className="animate-[slide-down_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex items-center justify-between gap-3 border-b border-rose/25 bg-[linear-gradient(180deg,rgba(244,63,94,0.09),rgba(244,63,94,0.04))] px-7 py-2.5 text-[12.5px] text-ink backdrop-blur-md max-[720px]:px-3.5"
          role="alert"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[9px] bg-rose/12 text-rose">
              <Icon name="warning" size={14} />
            </span>
            <span className="min-w-0 truncate">{error}</span>
          </span>
          <button
            className="shrink-0 cursor-pointer rounded-lg border border-rose/25 bg-surface-solid/80 px-2.5 py-1 text-[11px] font-bold text-rose transition-colors duration-150 hover:bg-rose/15"
            onClick={onCloseError}
            type="button"
          >
            {t("statusbar.close")}
          </button>
        </div>
      )}
    </div>
  );
}
