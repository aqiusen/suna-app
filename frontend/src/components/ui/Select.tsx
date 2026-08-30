import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

/**
 * 轻量 Select：Radix 提供键盘导航与无障碍语义，视觉用 Tailwind 定制。
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <SelectPrimitive.Root
      disabled={disabled}
      onValueChange={(value) => onValueChange(value as T)}
      value={value}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className="inline-flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-3 text-[13px] font-semibold text-ink transition-colors duration-150 hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-blue/40 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={14} className="text-ink-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] z-40 max-h-72 overflow-hidden rounded-xl border border-line bg-surface-solid p-1 shadow-lg"
          position="popper"
          sideOffset={6}
        >
          {/* 外层裁切圆角，内层负责滚动，避免 WebKit 滑块贴住菜单边缘。 */}
          <SelectPrimitive.Viewport className="max-h-[calc(18rem-0.5rem)] overflow-y-auto">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="relative flex cursor-pointer items-center rounded-lg py-2 pr-8 pl-2.5 text-[13px] text-ink-soft transition-colors duration-100 outline-none data-[highlighted]:bg-blue-soft data-[highlighted]:text-ink data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45"
                disabled={option.disabled}
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 text-blue-strong">
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
