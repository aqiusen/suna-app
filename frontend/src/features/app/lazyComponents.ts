import { lazy } from "react";

export const CommandPalette = lazy(() =>
  import("../commands/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);

export const RuntimeSettings = lazy(() =>
  import("../settings/RuntimeSettings").then((module) => ({
    default: module.RuntimeSettings,
  })),
);

export const RunDetails = lazy(() =>
  import("../run/RunDetails").then((module) => ({
    default: module.RunDetails,
  })),
);
