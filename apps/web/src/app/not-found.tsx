/**
 * 404 for paths outside any locale. The proxy redirects almost every path to a locale, so this
 * renders only for requests it does not match (for example a missing file).
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <head>
        <title>404</title>
      </head>
      <body>
        <main>
          <h1>404</h1>
        </main>
      </body>
    </html>
  );
}
