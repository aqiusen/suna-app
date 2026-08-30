import { useEffect, useId, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/ui/Select";
import { gatewayPath } from "../../lib/desktopGateway";
import { useT } from "../../lib/i18n";
import type { ConfigModel } from "../../lib/runtimeBridge";
import type { SettingsTabProps } from "./RuntimeSettings";

type ModelDraft = {
  provider: string;
  protocol: string;
  model: string;
  base_url: string;
  context_window: string;
  max_output_tokens: string;
  api_key: string;
  strengths: string;
  subtask_for: string;
};

const EMPTY_DRAFT: ModelDraft = {
  provider: "",
  protocol: "openai_chat",
  model: "",
  base_url: "",
  context_window: "",
  max_output_tokens: "",
  api_key: "",
  strengths: "",
  subtask_for: "",
};

const PROTOCOLS = [
  "openai_chat",
  "openai_responses",
  "anthropic",
  "ollama",
  "gemini",
];
const MODEL_LIST_CACHE_KEY = "suna-app.model-list-cache.v1";

function modelRef(model: ConfigModel) {
  return `${model.provider}/${model.model}`;
}

function fromModel(model: ConfigModel): ModelDraft {
  return {
    provider: model.provider,
    protocol: model.protocol,
    model: model.model,
    base_url: model.base_url ?? "",
    context_window: model.context_window ? String(model.context_window) : "",
    max_output_tokens: model.max_output_tokens
      ? String(model.max_output_tokens)
      : "",
    api_key: "",
    strengths: (model.strengths ?? []).join(", "),
    subtask_for: (model.subtask_for ?? []).join(", "),
  };
}

function modelSuggestions(models: string[]) {
  return [...new Set(models)];
}

function modelListCacheKey(
  draft: Pick<ModelDraft, "provider" | "protocol" | "base_url">,
) {
  const provider = draft.provider.trim().toLowerCase();
  const protocol = draft.protocol.trim().toLowerCase();
  const baseURL = draft.base_url.trim().replace(/\/+$/, "");
  if (!provider || !protocol || !baseURL) return "";
  return JSON.stringify([provider, protocol, baseURL]);
}

function readModelListCache(cacheKey: string) {
  if (!cacheKey) return [];
  try {
    const cache = JSON.parse(
      window.localStorage.getItem(MODEL_LIST_CACHE_KEY) ?? "{}",
    ) as Record<string, unknown>;
    const models = cache[cacheKey];
    return Array.isArray(models)
      ? models.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeModelListCache(cacheKey: string, models: string[]) {
  if (!cacheKey) return;
  try {
    const cache = JSON.parse(
      window.localStorage.getItem(MODEL_LIST_CACHE_KEY) ?? "{}",
    ) as Record<string, unknown>;
    cache[cacheKey] = [...new Set(models)];
    window.localStorage.setItem(MODEL_LIST_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 本地缓存只是减少重复下载，写失败不影响模型配置本身。
  }
}

/** 模型 Tab：列表 + 新增/编辑（对齐 TUI 表单）+ 删除 + 激活（设计 §10.2）。 */
export function ModelsTab({
  cap,
  config,
  onConfig,
  onApplySessionModel,
  rpc,
}: SettingsTabProps) {
  const t = useT();
  const [editing, setEditing] = useState<ConfigModel | "new" | undefined>();
  const [draft, setDraft] = useState<ModelDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string>();
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  function startEdit(model: ConfigModel | "new") {
    const nextDraft = model === "new" ? EMPTY_DRAFT : fromModel(model);
    setEditing(model);
    setDraft(nextDraft);
    setError(undefined);
    setDiscoveredModels(readModelListCache(modelListCacheKey(nextDraft)));
  }

  function enteredAPIKey() {
    const value = draft.api_key.trim();
    if (
      editing !== undefined &&
      editing !== "new" &&
      value === editing.api_key_hint
    ) {
      return "";
    }
    return value;
  }

  async function save() {
    if (!draft.provider.trim() || !draft.model.trim()) {
      setError(t("models.error.required"));
      return;
    }
    if (!draft.base_url.trim()) {
      setError(t("models.error.endpoint"));
      return;
    }
    const payload = {
      provider: draft.provider.trim(),
      protocol: draft.protocol,
      model: draft.model.trim(),
      base_url: draft.base_url.trim(),
      context_window: draft.context_window
        ? Number(draft.context_window)
        : undefined,
      max_output_tokens: draft.max_output_tokens
        ? Number(draft.max_output_tokens)
        : undefined,
      strengths: draft.strengths
        ? draft.strengths
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
      subtask_for: draft.subtask_for
        ? draft.subtask_for
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
    };
    const previousRef =
      editing !== undefined && editing !== "new" ? modelRef(editing) : "";
    const nextRef = `${payload.provider}/${payload.model}`;
    try {
      const next = await rpc("config.set", {
        action: "upsert_model",
        model: payload,
        model_ref: previousRef || undefined,
        api_key: enteredAPIKey() || undefined,
      });
      onConfig(next);
      if (previousRef && activeRef === previousRef && nextRef !== previousRef) {
        await onApplySessionModel?.(nextRef);
      }
      setEditing(undefined);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("models.error.save"),
      );
    }
  }

  async function remove(model: ConfigModel) {
    const hasKey = model.has_api_key;
    const message = hasKey
      ? t("models.deleteConfirm", { name: modelRef(model) })
      : t("models.deleteConfirmSimple", { name: modelRef(model) });
    if (!window.confirm(message)) return;
    try {
      const next = await rpc("config.set", {
        action: "delete_model",
        model_ref: modelRef(model),
        delete_api_key: hasKey,
      });
      onConfig(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("models.error.delete"),
      );
    }
  }

  async function activate(model: ConfigModel) {
    const ref = modelRef(model);
    try {
      const next = await rpc("config.set", {
        action: "activate_model",
        active_model: ref,
      });
      onConfig(next);
      // 全局默认只影响新会话；当前输入框读的是 session.model_ref，必须一并切换。
      await onApplySessionModel?.(ref);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("models.error.activate"),
      );
    }
  }

  if (!config) return null;
  const activeRef = config.active_model;
  const suggestions = modelSuggestions(discoveredModels);

  function canDiscoverWithSavedKey() {
    return (
      editing !== undefined &&
      editing !== "new" &&
      editing.has_api_key === true &&
      !enteredAPIKey() &&
      cap("config.discoverModels") &&
      draft.provider.trim() === editing.provider &&
      draft.protocol === editing.protocol &&
      draft.base_url.trim() === (editing.base_url ?? "").trim()
    );
  }

  async function discoverModels() {
    if (discovering) return;
    if (!draft.base_url.trim()) {
      setError(t("models.error.endpoint"));
      return;
    }
    const useSavedKey = canDiscoverWithSavedKey();
    const apiKey = enteredAPIKey();
    if (!apiKey && !useSavedKey) {
      setError(t("models.error.discoverKey"));
      return;
    }
    setDiscovering(true);
    setError(undefined);
    try {
      if (useSavedKey && editing !== "new" && editing !== undefined) {
        const result = await rpc("config.discoverModels", {
          model_ref: modelRef(editing),
        });
        if (result.error_message) throw new Error(result.error_message);
        setDiscoveredModels(result.models);
        writeModelListCache(modelListCacheKey(draft), result.models);
        return;
      }
      const response = await fetch(gatewayPath("/api/v1/models/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: draft.base_url,
          api_key: apiKey,
          protocol: draft.protocol,
        }),
      });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.models)) {
        const message =
          typeof body?.error?.message === "string"
            ? body.error.message
            : t("models.error.discover");
        throw new Error(message);
      }
      const nextModels = body.models.filter(
        (item: unknown) => typeof item === "string",
      );
      setDiscoveredModels(nextModels);
      writeModelListCache(modelListCacheKey(draft), nextModels);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("models.error.discover"),
      );
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[13px] font-extrabold text-ink">
          {t("models.title")}
        </h3>
        <button
          className="cursor-pointer rounded-lg bg-blue px-3 py-1.5 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong"
          onClick={() => startEdit("new")}
          type="button"
        >
          {t("models.add")}
        </button>
      </div>

      {editing ? (
        <form
          className="grid gap-3 rounded-xl border border-blue/30 bg-blue-soft/25 p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Provider"
              onChange={(value) => {
                const nextDraft = { ...draft, provider: value };
                setDraft(nextDraft);
                setDiscoveredModels(
                  readModelListCache(modelListCacheKey(nextDraft)),
                );
              }}
              required
              value={draft.provider}
            />
            <label className="grid gap-1 text-[11px] font-bold text-ink-soft">
              {t("models.protocol")}
              <Select
                ariaLabel={t("models.protocol")}
                onValueChange={(value) => {
                  const nextDraft = { ...draft, protocol: value };
                  setDraft(nextDraft);
                  setDiscoveredModels(
                    readModelListCache(modelListCacheKey(nextDraft)),
                  );
                }}
                options={PROTOCOLS.map((value) => ({ value, label: value }))}
                value={draft.protocol}
              />
            </label>
          </div>
          <Field
            label={t("models.modelName")}
            onChange={(value) => setDraft({ ...draft, model: value })}
            onPickSuggestion={(value) => setDraft({ ...draft, model: value })}
            required
            sideAction={
              <button
                aria-label={t("models.discover")}
                className="inline-grid h-[38px] w-[38px] shrink-0 cursor-pointer place-items-center rounded-lg border border-line bg-surface-raised text-ink-muted transition-colors duration-150 hover:border-blue/30 hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!draft.base_url.trim() || discovering}
                onClick={() => void discoverModels()}
                title={t("models.discover")}
                type="button"
              >
                <Icon name="download" size={16} />
              </button>
            }
            showSuggestions={discoveredModels.length > 0}
            suggestions={suggestions}
            value={draft.model}
          />
          <Field
            label="Endpoint"
            onChange={(value) => {
              const nextDraft = { ...draft, base_url: value };
              setDraft(nextDraft);
              setDiscoveredModels(
                readModelListCache(modelListCacheKey(nextDraft)),
              );
            }}
            placeholder="https://api.example.com"
            required
            value={draft.base_url}
          />
          <Field
            hint={
              editing !== "new" && editing?.api_key_hint
                ? t("models.apiKeySavedHint", { key: editing.api_key_hint })
                : undefined
            }
            label="API Key"
            onChange={(value) => setDraft({ ...draft, api_key: value })}
            placeholder={
              editing !== "new" && editing.has_api_key
                ? t("models.endpointKeep")
                : t("models.endpointOptional")
            }
            type="password"
            value={draft.api_key}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Context Window"
              onChange={(value) =>
                setDraft({ ...draft, context_window: value })
              }
              placeholder="128000"
              type="number"
              value={draft.context_window}
            />
            <Field
              label="Max Output"
              onChange={(value) =>
                setDraft({ ...draft, max_output_tokens: value })
              }
              placeholder="8192"
              type="number"
              value={draft.max_output_tokens}
            />
          </div>
          <details className="rounded-lg border border-line bg-surface-raised/40 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-bold text-ink-muted transition-colors duration-150 hover:text-ink">
              {t("models.advancedRouting")}
            </summary>
            <div className="mt-2.5 grid gap-2.5">
              <Field
                hint={t("models.strengthsHint")}
                label={t("models.strengths")}
                onChange={(value) => setDraft({ ...draft, strengths: value })}
                placeholder={t("models.strengthsPlaceholder")}
                value={draft.strengths}
              />
              <Field
                hint={t("models.subtaskForHint")}
                label={t("models.subtaskFor")}
                onChange={(value) => setDraft({ ...draft, subtask_for: value })}
                placeholder={t("models.subtaskForPlaceholder")}
                value={draft.subtask_for}
              />
            </div>
          </details>
          {error && (
            <small className="text-[12px] font-semibold text-rose">
              {error}
            </small>
          )}
          <div className="flex justify-end gap-2">
            <button
              className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle"
              onClick={() => setEditing(undefined)}
              type="button"
            >
              {t("models.cancel")}
            </button>
            <button
              className="cursor-pointer rounded-lg bg-blue px-3 py-1.5 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong"
              type="submit"
            >
              {t("models.save")}
            </button>
          </div>
          {discovering && (
            <small className="text-[11px] font-semibold text-ink-muted">
              {t("models.discovering")}
            </small>
          )}
        </form>
      ) : (
        config.models.map((model) => {
          const ref = modelRef(model);
          const active = ref === activeRef;
          return (
            <div
              className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-[13px]"
              key={ref}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <strong className="truncate text-ink">{ref}</strong>
                  {active && (
                    <span className="rounded-sm bg-green-soft px-1.5 py-px text-[10px] font-bold text-green">
                      {t("models.inUse")}
                    </span>
                  )}
                </span>
                <small className="mt-0.5 block truncate text-[11px] font-normal text-ink-muted">
                  {model.protocol}
                  {model.base_url ? ` · ${model.base_url}` : ""}
                  {model.context_window ? ` · ${model.context_window} ctx` : ""}
                </small>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {!active && (
                  <button
                    className="cursor-pointer text-[11px] font-bold text-blue-strong transition-opacity duration-150 hover:opacity-75"
                    onClick={() => void activate(model)}
                    type="button"
                  >
                    {t("models.setDefault")}
                  </button>
                )}
                <button
                  className="cursor-pointer text-[11px] font-bold text-ink-muted transition-opacity duration-150 hover:text-ink"
                  onClick={() => startEdit(model)}
                  type="button"
                >
                  {t("models.edit")}
                </button>
                <button
                  className="cursor-pointer text-[11px] font-bold text-rose transition-opacity duration-150 hover:opacity-75"
                  onClick={() => void remove(model)}
                  type="button"
                >
                  {t("models.delete")}
                </button>
              </span>
            </div>
          );
        })
      )}
      {!editing && config.models.length === 0 && (
        <p className="text-[13px] text-ink-muted">{t("models.empty")}</p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onPickSuggestion,
  placeholder,
  hint,
  required,
  showSuggestions,
  sideAction,
  suggestions,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onPickSuggestion?: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  showSuggestions?: boolean;
  sideAction?: ReactNode;
  suggestions?: string[];
  type?: string;
}) {
  const inputId = useId();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const options = suggestions ?? [];
  const listId =
    options.length > 0
      ? `model-field-${label.replace(/\W+/g, "-").toLowerCase()}`
      : undefined;
  useEffect(() => {
    if (showSuggestions && options.length > 0) {
      setSuggestionsOpen(true);
    }
  }, [options.length, showSuggestions]);

  return (
    <div className="grid gap-1 text-[11px] font-bold text-ink-soft">
      <label htmlFor={inputId}>{label}</label>
      <span className="flex items-center gap-2">
        <input
          id={inputId}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-[12px] text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
          list={listId}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            if (showSuggestions && options.length > 0) {
              setSuggestionsOpen(true);
            }
          }}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value}
        />
        {sideAction}
      </span>
      {listId && (
        <datalist id={listId}>
          {options.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      )}
      {showSuggestions &&
        suggestionsOpen &&
        options.length > 0 &&
        onPickSuggestion && (
          <div className="overflow-hidden rounded-lg border border-line bg-surface-raised p-1">
            {/* 圆角由外壳裁切；滚动列表留在内层，滑块不会侵入菜单边缘。 */}
            <div className="grid max-h-[calc(9rem-0.5rem)] gap-1 overflow-y-auto pr-0.5">
              {options.map((item) => (
                <button
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium transition-colors duration-100 hover:bg-surface-subtle hover:text-ink ${
                    item === value
                      ? "bg-surface-subtle text-ink"
                      : "text-ink-soft"
                  }`}
                  key={item}
                  onClick={() => {
                    onPickSuggestion(item);
                    setSuggestionsOpen(false);
                  }}
                  type="button"
                >
                  <span className="truncate">{item}</span>
                  {item === value && (
                    <Icon
                      className="shrink-0 text-blue-strong"
                      name="check"
                      size={13}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      {hint && (
        <span className="font-medium text-[10.5px] leading-relaxed text-ink-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
