import type messages from "../../messages/en.json";
import type { routing } from "./routing";

// Typed message keys and locales for next-intl: a missing key is a type error.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
