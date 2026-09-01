import { createContext } from "react";

export type Locale = "zh" | "en";

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export const LocaleContext = createContext<{
  locale: Locale;
  t: Translate;
  changeLocale: (locale: Locale) => void;
}>({
  locale: "zh",
  t: (key) => key,
  changeLocale: () => undefined,
});
