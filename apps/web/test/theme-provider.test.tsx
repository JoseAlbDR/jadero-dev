// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "../src/components/theme-provider";

// React only acts on this in development builds, which Vitest uses; the e2e suite runs production.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia, which next-themes reads for the system theme: a light-mode stub.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// Reproduces the locale switch: the provider mounts on the client, not from server HTML.
it("mounts on the client without React's script tag warning", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  await act(async () => {
    root.render(<ThemeProvider>content</ThemeProvider>);
  });

  const messages = error.mock.calls.map((call) => String(call[0]));
  expect(messages.filter((m) => m.includes("Encountered a script tag"))).toEqual([]);
  act(() => root.unmount());
});
