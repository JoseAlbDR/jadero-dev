import { notFound } from "next/navigation";

/** Catches unknown paths inside a locale so they get the localized 404. */
export default function CatchAllPage() {
  notFound();
}
