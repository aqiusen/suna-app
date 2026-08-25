import type { ReactNode, Ref } from "react";
import {
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Ellipsis,
  Eye,
  Folder,
  Image,
  Link,
  MessageSquare,
  Moon,
  PanelRight,
  Paperclip,
  Pause,
  Pin,
  Plug,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
  Sun,
  TriangleAlert,
  Users,
  Wrench,
  X,
  type LucideProps,
} from "lucide-react";

export type IconName =
  | "arrow-up"
  | "book"
  | "brain"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "copy"
  | "database"
  | "ellipsis"
  | "eye"
  | "folder"
  | "image"
  | "link"
  | "message"
  | "moon"
  | "panel"
  | "paperclip"
  | "pause"
  | "pin"
  | "plus"
  | "search"
  | "settings"
  | "shield"
  | "sparkle"
  | "sun"
  | "tool"
  | "users"
  | "warning"
  | "plug";

const icons: Record<IconName, React.ComponentType<LucideProps>> = {
  "arrow-up": ArrowUp,
  book: BookOpen,
  brain: Brain,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  close: X,
  copy: Copy,
  database: Database,
  ellipsis: Ellipsis,
  eye: Eye,
  folder: Folder,
  image: Image,
  link: Link,
  message: MessageSquare,
  moon: Moon,
  panel: PanelRight,
  paperclip: Paperclip,
  pause: Pause,
  pin: Pin,
  plus: Plus,
  search: Search,
  settings: Settings,
  shield: Shield,
  sparkle: Sparkles,
  sun: Sun,
  tool: Wrench,
  users: Users,
  warning: TriangleAlert,
  plug: Plug,
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const LucideIcon = icons[name];
  return (
    <LucideIcon
      aria-hidden="true"
      className={className}
      size={size}
      strokeWidth={1.8}
    />
  );
}

export function IconButton({
  label,
  children,
  onClick,
  className = "",
  ariaExpanded,
  ariaControls,
  buttonRef,
  disabled,
  ref,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  /** React 19 ref-as-prop：供 Radix Trigger asChild 注入 ref。 */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-label={label}
      className={`icon-button ${className}`}
      disabled={disabled}
      onClick={onClick}
      ref={ref ?? buttonRef}
      type="button"
    >
      {children}
    </button>
  );
}
