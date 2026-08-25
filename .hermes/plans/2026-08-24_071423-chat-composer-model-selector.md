# Chat Composer Controls Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Upgrade `frontend/src/features/chat/Composer.tsx` so the Suna chat input matches the attached reference: a compact rounded composer with a plus menu, approval-mode popover, inline model selector, and send button.

**Architecture:** Keep business authority in Runtime and Gateway. The frontend only renders the controls and calls existing public RPC methods: `session.update` for per-session `model_ref`, `config.set` with `guard_mode` for global approval mode, `agent.sendMessage` for submit, existing desktop file picker helpers for attachments, and `config.get` data for model choices. No Runtime internals, no model credentials, no browser-side persistence.

**Tech Stack:** React + TypeScript strict, Tailwind v4 tokens, existing Radix Select wrapper, lucide-react icons, Vitest + Testing Library.

---

## Design Read

Reading this as: dense product UI for a local agent console, with a Codex-style minimal chat composer, leaning toward the app's existing Tailwind token system and Radix primitives.

- `DESIGN_VARIANCE: 3` because this is a functional control, not a marketing surface.
- `MOTION_INTENSITY: 2` because only focus, hover, active, and menu transitions are needed.
- `VISUAL_DENSITY: 6` because the composer must expose attachments, model choice, and send without becoming noisy.

## Current Context

Inspected files:

- `frontend/src/features/chat/Composer.tsx`
  - Already supports text submit, Enter/Shift+Enter, optimistic clear, URL image chips, native file/folder attach, paste file paths, observer/disabled states.
  - Current UI places textarea and action buttons in one row.
  - Current attach controls are separate paperclip/folder/image buttons.
- `frontend/src/features/chat/Composer.test.tsx`
  - Covers submit, restore on failure, disabled empty send, Enter behavior.
- `frontend/src/App.tsx`
  - Passes `send`, `canAttachImageUrl`, disabled/observer/waiting into Composer.
  - Has `config`, `selected`, `updateModel`, `running`, `canControl`, `sessionActionsFrozen` available in the app shell.
- `frontend/src/features/runtime/useRuntimeSession.ts`
  - Loads `config.get` and normalizes runtime config.
  - Uses `createSessionActions`, which already exposes `updateModel` to `RunDetailsOverlay`.
- `frontend/src/lib/runtimeTypes.ts`
  - `RuntimeConfig.models`, `RuntimeConfig.active_model`, `RuntimeConfig.guard_mode`, and `SessionInfo.model_ref` exist.
  - `session.update` accepts `{ session_id, model_ref?: string | null }`.
  - `config.set` accepts `{ action: "update_general", guard_mode?: string }`, which is the right path for the approval mode selector.
- `frontend/src/components/ui/Select.tsx`
  - Existing accessible Radix select wrapper can be reused or lightly extended.

Reference screenshot requirements:

- Rounded composer card with subtle border and raised surface.
- Input placeholder at top-left.
- Bottom toolbar row:
  - left: plus icon button, approval-mode pill (`帮我批准`), model selector button.
  - right: compact model/status text, circular send button with up arrow.
- Neutral grayscale, low noise, no gradient/glow.
- Empty state has disabled or muted send affordance.

Second approval popover screenshot requirements:

- Non-modal popover anchored to the `帮我批准` pill in the composer toolbar.
- Width around `330px`, rounded `12px`, white/surface background, subtle border, soft shadow.
- Three stacked option rows with icon, title, description, and selected checkmark:
  1. `请求批准` - `编辑外部文件和使用互联网时始终询问`
  2. `帮我批准` - `仅对检测到的风险操作请求批准`
  3. `完全访问权限` - `可不受限制地访问互联网和你电脑上的任何文件`
- The selected row shows a check icon on the right. In the reference, `帮我批准` is selected.
- The dangerous `完全访问权限` row uses the app danger color (`rose`/orange-red tone) for icon, title, and description.
- No backdrop. Outside click and Escape close the popover.

## Product Behavior

### 1. Plus button

Replace multiple exposed attachment buttons with one `+` button that opens an attachment menu.

Menu options:

1. `Attach files`
   - Desktop shell only.
   - Calls existing `selectLocalFiles()` through current `pickLocalFiles()`.
2. `Attach folder`
   - Desktop shell only.
   - Calls existing `selectLocalDirectory()` through current `pickLocalDirectory()`.
3. `Image URL`
   - Only when `canAttachImageUrl` is true.
   - Toggles the existing URL input/chip flow.

If no attachment source is available, hide or disable the plus button with a useful `aria-label`.

### 2. Approval mode popover (`帮我批准`)

Add a pill trigger between the plus button and model selector. It controls the Runtime approval / guard mode.

Mode options:

| UI value | Label | Description | Runtime `guard_mode` |
| --- | --- | --- | --- |
| `ask` | `请求批准` | `编辑外部文件和使用互联网时始终询问` | confirm with Runtime owner before coding. Prefer `ask`, `strict`, or existing documented value if already used elsewhere. |
| `auto` | `帮我批准` | `仅对检测到的风险操作请求批准` | existing default or `auto` / `review`. Confirm exact value against Runtime contract before implementation. |
| `full` | `完全访问权限` | `可不受限制地访问互联网和你电脑上的任何文件` | high-risk permissive mode. Confirm exact value against Runtime contract before implementation. |

Implementation notes:

- Do not invent unsupported `guard_mode` strings in production code. First inspect existing Runtime / config docs or run-time returned `config.guard_mode` values. If the exact mapping is unclear, implement the UI behind a mapping constant with a TODO and do not enable saving until the Runtime contract is confirmed.
- Current selected mode comes from `config.guard_mode`. If it is missing, default the UI label to `帮我批准` but do not write a value until the user changes it.
- On selection, call `rpc("config.set", { action: "update_general", guard_mode: nextGuardMode })`.
- On success, call `setConfig(next)` through the same path used by Settings, so Settings and Composer stay in sync.
- Disable the trigger when `config` is unavailable, `canConfig` is false, the app is syncing, or a save is in progress.
- This is a global runtime setting, not per-session state. The UI should not imply it only changes the current chat.
- The `完全访问权限` option is high risk. The UI must present it in danger color and may require an extra `window.confirm` if Runtime does not already guard this change. Do not silently escalate permissions.

Popover behavior:

- Click trigger toggles popover.
- Click option saves then closes on success; keep open and show inline error on failure.
- Outside click closes.
- Escape closes.
- Selected option shows a check icon on the right.

### 3. Model selector

Add an inline model selector inside the Composer toolbar.

Rules:

- Selected model display priority:
  1. `selected.model_ref`
  2. `active.snapshot?.session.model_ref`
  3. `config.active_model`
- Options come from `config.models`, displayed as `provider/model`.
- If the selected session is running, waiting, observer-only, syncing, or no selected session exists, disable changing the model.
- On change, call `updateModel(nextModelRef)` from app shell.
- Keep the existing Run Details model selector as-is for now. Both should call the same `updateModel` path and stay in sync through `session.updated` / snapshot merge.
- If `config.models` is empty, show a disabled selector label such as `No model` and optionally clicking can open Settings > Models in a later iteration. Do not add that extra settings shortcut in the first pass unless UI asks for it.

### 4. Send button

Keep current submit semantics:

- Disabled when draft, pending image URL, added image URLs, and local files are all empty.
- Disabled while sending or when `disabled` is true.
- Enter sends, Shift+Enter inserts newline, Cmd/Ctrl+Enter sends.
- Optimistic clear and restore-on-failure remains unchanged.

Fix current disabled condition bug while touching this area:

- Current disabled expression checks `draft`, `imageUrl`, `imageUrls`, but not `localFiles`.
- Add `localFiles.length === 0` to match `submit()` so file-only messages can be sent.

## Component API Changes

Update `ComposerProps`:

```ts
import type { ConfigModel } from "../../lib/runtimeTypes";

type ComposerProps = {
  onSubmit: (parts: MessagePart[]) => Promise<void>;
  disabled?: boolean;
  waiting?: boolean;
  observer?: boolean;
  canAttachImageUrl?: boolean;
  focusTrigger?: number;

  models?: ConfigModel[];
  activeModelRef?: string;
  onModelChange?: (modelRef: string) => Promise<void> | void;
  modelChangeDisabled?: boolean;

  approvalMode?: string;
  onApprovalModeChange?: (mode: string) => Promise<void> | void;
  approvalModeDisabled?: boolean;
};
```

Add local helpers in Composer or a new small file if `Composer.tsx` would exceed the file target:

```ts
function modelRef(model: Pick<ConfigModel, "provider" | "model">) {
  return `${model.provider}/${model.model}`;
}

function shortModelLabel(ref?: string) {
  if (!ref) return "No model";
  const [, model = ref] = ref.split("/");
  return model;
}
```

Preferred split to keep `Composer.tsx` under control:

- Create `frontend/src/features/chat/ComposerAttachmentMenu.tsx`.
- Create `frontend/src/features/chat/ComposerApprovalMode.tsx`.
- Create `frontend/src/features/chat/ComposerModelSelect.tsx`.
- Keep validation and submit state in `Composer.tsx`.

## App Wiring

In `frontend/src/App.tsx`, pass model props:

```tsx
<Composer
  activeModelRef={
    selected?.model_ref ?? active.snapshot?.session.model_ref ?? config?.active_model
  }
  approvalMode={config?.guard_mode}
  approvalModeDisabled={!config || !canConfig || syncing}
  canAttachImageUrl={Boolean(hello?.content_sources.image_url)}
  disabled={sessionActionsFrozen || observer}
  modelChangeDisabled={
    sessionActionsFrozen || observer || running || selected?.status === "waiting"
  }
  models={config?.models ?? []}
  onApprovalModeChange={(guardMode) =>
    rpc("config.set", {
      action: "update_general",
      guard_mode: guardMode,
    }).then(setConfig)
  }
  onModelChange={(modelRef) => updateModel(modelRef)}
  onSubmit={send}
  observer={observer}
  ref={composerRef}
  waiting={selected?.status === "waiting"}
/>
```

If `updateModel` is currently typed to accept `string | null`, use `modelRef` string only from the Composer selector.

## Visual Structure

Target markup structure inside the composer card:

```tsx
<div className="composer-card">
  {observer notice}
  {image URL input and chips}
  {local file chips}

  <textarea className="composer-input" />

  <div className="composer-toolbar">
    <div className="composer-toolbar-left">
      <ComposerAttachmentMenu ... />
      <ComposerApprovalMode ... />
      <ComposerModelSelect ... />
    </div>
    <div className="composer-toolbar-right">
      <span className="composer-model-hint">{shortModelLabel(activeModelRef)}</span>
      <button aria-label={t("chat.send")}>
        <Icon name="arrow-up" />
      </button>
    </div>
  </div>
</div>
```

Tailwind direction:

- Card: `rounded-[16px] border border-line-strong bg-surface-solid px-3.5 pt-3 pb-2.5`.
- Textarea: `min-h-[42px] max-h-[132px] w-full resize-none bg-transparent px-1 py-1 text-[13.5px] leading-[21px]`.
- Toolbar: `mt-1 flex items-center justify-between gap-2`.
- Plus button: `grid h-8 w-8 place-items-center rounded-[9px] text-ink-muted hover:bg-surface-subtle hover:text-ink`.
- Approval trigger: `inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 text-[12px] font-medium text-ink-soft hover:bg-surface-raised hover:text-ink`.
- Approval popover: `absolute bottom-full left-0 z-50 mb-2 w-[330px] overflow-hidden rounded-xl border border-line bg-surface-solid py-2 shadow-[0_12px_34px_rgb(15_18_28_/_0.14)]`.
- Approval rows: `flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-surface-subtle`; danger row uses `text-rose` and `hover:bg-rose/5`.
- Model selector trigger: `inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-[9px] px-2 text-[12px] text-ink-soft hover:bg-surface-subtle hover:text-ink`.
- Send: `grid h-8 w-8 place-items-center rounded-full bg-ink text-white disabled:bg-ink-muted/35 disabled:text-white/70`.
- Mobile: keep send at `42px`, toolbar wraps only if needed, model label truncates.

Avoid:

- Colored soft badges unless indicating an actual state.
- Gradients, glows, large shadows, heavy font weights.
- More than one visible attachment icon in the idle toolbar.

## i18n Additions

Add keys to `frontend/src/lib/i18n.tsx`:

```ts
"chat.addMenu": { zh: "添加内容", en: "Add content" },
"chat.model": { zh: "模型", en: "Model" },
"chat.noModel": { zh: "未配置模型", en: "No model" },
"chat.changeModel": { zh: "切换模型", en: "Change model" },
"chat.approvalMode": { zh: "批准方式", en: "Approval mode" },
"chat.approval.ask": { zh: "请求批准", en: "Ask for approval" },
"chat.approval.askDesc": {
  zh: "编辑外部文件和使用互联网时始终询问",
  en: "Always ask before editing external files or using the internet",
},
"chat.approval.auto": { zh: "帮我批准", en: "Help me approve" },
"chat.approval.autoDesc": {
  zh: "仅对检测到的风险操作请求批准",
  en: "Only ask for approval for detected risky actions",
},
"chat.approval.full": { zh: "完全访问权限", en: "Full access" },
"chat.approval.fullDesc": {
  zh: "可不受限制地访问互联网和你电脑上的任何文件",
  en: "Allow unrestricted internet access and access to files on this computer",
},
```

Reuse existing:

- `chat.attachFile`
- `chat.attachFolder`
- `chat.imageUrl`
- `chat.send`

## Implementation Tasks

### Task 1: Add failing tests for file-only send and model selector rendering

**Objective:** Lock current behavior and expose the known file-only send button bug before implementation.

**Files:**

- Modify: `frontend/src/features/chat/Composer.test.tsx`

**Step 1: Add tests**

Tests to add:

1. Composer displays active model label when `models` and `activeModelRef` are provided.
2. Changing model calls `onModelChange` with the selected `provider/model`.
3. Composer displays current approval mode label from `approvalMode`.
4. Opening approval popover shows all three rows: `请求批准`, `帮我批准`, `完全访问权限`.
5. Selecting an approval row calls `onApprovalModeChange` with the mapped `guard_mode` value.
6. File-only attachment enables send button.

For file-only attachment, mock `desktopGateway` before importing `Composer`:

```ts
vi.mock("../../lib/desktopGateway", () => ({
  isNativeDesktopShell: () => true,
  resolvePastedFiles: vi.fn(),
  selectLocalDirectory: vi.fn(),
  selectLocalFiles: vi.fn().mockResolvedValue([
    { path: "/tmp/a.png", name: "a.png", mime_type: "image/png", size: 10 },
  ]),
}));
```

**Step 2: Verify RED**

Run:

```bash
pnpm test -- Composer.test.tsx
```

Expected:

- New model and approval tests fail because props/UI do not exist yet.
- File-only send test fails because the send button remains disabled.

### Task 2: Add Composer props and read-only model / approval labels

**Objective:** Thread model and approval-mode data into Composer without changing Runtime state yet.

**Files:**

- Modify: `frontend/src/features/chat/Composer.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/i18n.tsx`

**Steps:**

1. Add `models`, `activeModelRef`, `onModelChange`, `modelChangeDisabled` props.
2. Add `approvalMode`, `onApprovalModeChange`, `approvalModeDisabled` props.
3. Add i18n keys.
4. Render disabled/readonly labels for model and approval mode in the toolbar.
5. Pass model and approval props from `App.tsx`.
6. Run the targeted test and typecheck.

Run:

```bash
pnpm test -- Composer.test.tsx
pnpm typecheck
```

### Task 3: Implement ComposerModelSelect

**Objective:** Make the model selector interactive and accessible.

**Files:**

- Create: `frontend/src/features/chat/ComposerModelSelect.tsx`
- Modify: `frontend/src/features/chat/Composer.tsx`
- Modify: `frontend/src/features/chat/Composer.test.tsx`

**Implementation notes:**

- Use existing `Select` wrapper if its trigger styling is acceptable.
- If the current `Select` is too form-like, either add an optional `triggerClassName` prop to `Select.tsx` or implement a small Radix select in `ComposerModelSelect.tsx`.
- The select must have `aria-label={t("chat.changeModel")}`.
- Options are `models.map(modelRef)`.
- Disable if no models, `modelChangeDisabled`, `disabled`, or `sending`.

**Verification:**

```bash
pnpm test -- Composer.test.tsx
pnpm typecheck
```

### Task 4: Implement approval mode popover

**Objective:** Add the missing `帮我批准` popover from the second screenshot.

**Files:**

- Create: `frontend/src/features/chat/ComposerApprovalMode.tsx`
- Modify: `frontend/src/features/chat/Composer.tsx`
- Modify: `frontend/src/features/chat/Composer.test.tsx`
- Modify: `frontend/src/App.tsx` if wiring was not completed in Task 2

**Implementation notes:**

- Use a small custom popover or an existing Radix primitive if available. Do not install a new dependency only for this.
- Trigger label is the selected approval label, defaulting visually to `帮我批准` when `approvalMode` is absent.
- Rows use icon + title + description + selected checkmark.
- Danger row is always styled with the app danger color.
- Add outside-click and Escape close behavior.
- Save via `onApprovalModeChange(mappedGuardMode)`.
- Confirm the exact Runtime `guard_mode` string mapping before enabling saving. If unclear, implement the presentational component and leave save disabled with a clear TODO in code comments rather than inventing unsupported values.

**Verification:**

```bash
pnpm test -- Composer.test.tsx
pnpm typecheck
```

### Task 5: Implement plus attachment menu

**Objective:** Replace idle toolbar attachment clutter with a single plus menu.

**Files:**

- Create: `frontend/src/features/chat/ComposerAttachmentMenu.tsx`
- Modify: `frontend/src/features/chat/Composer.tsx`
- Modify: `frontend/src/features/chat/Composer.test.tsx`

**Implementation notes:**

- Use Radix dropdown menu if already installed. If not installed, use a compact internal popover state with a button and absolute-positioned menu; do not add a dependency just for this.
- The plus button should be the only idle attachment control.
- Menu items call current callbacks:
  - `onAttachFiles`
  - `onAttachFolder`
  - `onToggleImageUrl`
- Preserve current native shell and image URL gating.
- Close menu after item click.
- `Escape` and outside click should close if implementing custom popover.

**Verification:**

```bash
pnpm test -- Composer.test.tsx
pnpm typecheck
```

### Task 6: Restructure visual layout and fix send disabled condition

**Objective:** Match the screenshot layout while preserving all existing submit behavior.

**Files:**

- Modify: `frontend/src/features/chat/Composer.tsx`
- Possibly modify: `frontend/src/styles/tailwind.css` only if reusable component classes are preferred.

**Required behavior:**

- Textarea occupies the top row.
- Toolbar sits below it.
- Plus, approval mode, and model selector are left-aligned.
- Short active model label and send button are right-aligned.
- Add `localFiles.length === 0` to send disabled condition.

**Verification:**

```bash
pnpm test -- Composer.test.tsx
pnpm typecheck
```

### Task 7: Full frontend validation

**Objective:** Ensure no format, lint, type, test, or build regressions.

**Files:**

- No planned file changes.

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected:

- All commands pass.
- If existing unrelated failures appear, capture exact output and distinguish them from this feature.

## UI Handoff

UI owner should refine only the visual layer after the behavior lands:

- Confirm exact radius, padding, and width against the screenshot.
- Confirm whether the plus menu needs text labels or icon + text rows.
- Confirm exact copy, width, and danger color for the `帮我批准` approval popover.
- Confirm whether `完全访问权限` needs a second confirmation before saving.
- Confirm whether the right-side model hint should show full `provider/model`, short model name, or a compact version like `5.5 中`.
- Confirm disabled send color. It should read disabled when the composer is empty, not active.
- Confirm mobile behavior with soft keyboard and long model names.

Acceptance checklist for UI:

- Empty composer looks like the screenshot: calm card, top placeholder, bottom toolbar.
- One plus button replaces multiple idle attachment buttons.
- `帮我批准` trigger opens the approval popover with three rows, selected checkmark, and danger styling for full access.
- Model selector is discoverable but visually secondary.
- Send button is the strongest control, but disabled state is clear.
- Keyboard focus rings are visible.
- Touch targets are at least 40px on mobile.

## Risks and Tradeoffs

- Runtime may treat model changes on active/running sessions differently. The UI should disable changes while running to avoid race conditions.
- Runtime `guard_mode` value names must be confirmed before saving approval changes. Unsupported strings would produce misleading UI, so implement a guarded mapping.
- `完全访问权限` is a permission escalation. If Runtime does not already require confirmation, the Composer UI should add one rather than silently enabling it.
- `Composer.tsx` is already 441 lines, above the project guideline of 400. Splitting attachment menu, approval mode, and model selector is recommended.
- A custom popover can introduce outside-click bugs. Prefer existing Radix primitives if dependency is already present.

## Done Definition

- Composer supports add menu, approval-mode popover, model selector, and send button in the screenshot layout.
- File-only attachments can be sent.
- Approval mode reads from and writes to Runtime config using the confirmed `guard_mode` mapping.
- Model selection updates the current session through existing `session.update` flow.
- Existing image URL, native file/folder, paste, Enter, Shift+Enter, optimistic clear, observer, disabled, and waiting states still work.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass or any unrelated blocker is documented with real output.
