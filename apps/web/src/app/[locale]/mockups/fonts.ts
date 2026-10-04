import { Fraunces, Geist, Geist_Mono, Inter } from "next/font/google";

/*
 * Candidate typefaces of the three directions (ADR-023), self-hosted by next/font at build time.
 * Each one only defines a CSS variable; `mockups.css` points the theme fonts at it per direction.
 */
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
  display: "swap",
});

/** Class names that define every candidate font variable on the element that carries them. */
export const fontVariables = [geist, geistMono, inter, fraunces].map((f) => f.variable).join(" ");
