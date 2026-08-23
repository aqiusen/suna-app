import { Suspense, type ComponentProps } from "react";
import { CommandPalette, RunDetails, RuntimeSettings } from "./lazyComponents";
import { useT } from "../../lib/i18n";

export function RuntimeSettingsOverlay({
  open,
  ...props
}: ComponentProps<typeof RuntimeSettings> & { open: boolean }) {
  const t = useT();
  if (!open) return null;
  return (
    <>
      <button
        aria-label={t("common.closeSettings")}
        className="settings-scrim"
        onClick={props.onClose}
        type="button"
      />
      <Suspense fallback={null}>
        <RuntimeSettings {...props} />
      </Suspense>
    </>
  );
}

export function RunDetailsOverlay({
  open,
  ...props
}: ComponentProps<typeof RunDetails>) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <RunDetails open={open} {...props} />
    </Suspense>
  );
}

export function CommandPaletteOverlay(
  props: ComponentProps<typeof CommandPalette>,
) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette {...props} />
    </Suspense>
  );
}
