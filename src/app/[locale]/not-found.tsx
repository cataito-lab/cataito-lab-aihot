export const runtime = "edge";

export default function LocaleNotFound() {
  return (
    <html>
      <body>
        <h1>404 Not Found</h1>
        <p>Try <a href="/en">/en</a> or <a href="/llms.txt">/llms.txt</a> or <a href="/sitemap.xml">/sitemap.xml</a>.</p>
      </body>
    </html>
  );
}