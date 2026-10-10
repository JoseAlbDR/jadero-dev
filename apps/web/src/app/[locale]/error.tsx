"use client";

import { Button } from "@jadero/ui/components/button";
import { Card } from "@jadero/ui/components/card";
import { useTranslations } from "next-intl";

type LocaleErrorProps = Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>;

/**
 * Error boundary of every page in a locale, inside the layout (header and footer stay). A page
 * whose content API call failed lands here. It shows a localized message and a retry, never the
 * error: in production Next.js replaces a server error's message with a digest, and this component
 * does not print even that, so no URL, status or payload reaches the visitor.
 * @param props.retry re-renders the page, which fetches the content again.
 */
export default function LocaleError({ retry }: LocaleErrorProps) {
  const t = useTranslations("ErrorPage");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Card asChild className="md:p-10">
        <section>
          <h1 className="font-semibold text-4xl tracking-tight">{t("title")}</h1>
          <p className="mt-4 text-muted-foreground">{t("description")}</p>
          <Button type="button" variant="outline" className="mt-6" onClick={() => retry()}>
            {t("retry")}
          </Button>
        </section>
      </Card>
    </main>
  );
}
