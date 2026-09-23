export const WINDOWS_RELEASES_URL = 'https://github.com/grimvirusoffical-source/InfectedVoices-Windows/releases/latest';
export const WINDOWS_BODY = 'Windows installer from Releases when available.';
export const WINDOWS_CTA = 'View Windows Releases';

const HONEST_WINDOWS_ARTICLE = `    <article>
      <h2>Windows</h2>
      <p>${WINDOWS_BODY}</p>
      <p><a href="${WINDOWS_RELEASES_URL}">${WINDOWS_CTA}</a></p>
    </article>`;

export function claimsSignedOrSha(html) {
  return /\bSigned\b/i.test(html) || /SHA-?256/i.test(html);
}

export function withHonestWindows(html) {
  let page = String(html);
  const alreadyHonest = !claimsSignedOrSha(page)
    && page.includes(WINDOWS_BODY)
    && page.includes(`>${WINDOWS_CTA}<`)
    && page.includes(WINDOWS_RELEASES_URL);
  if (alreadyHonest) return page;

  const article = /<article>\s*<h2>Windows<\/h2>[\s\S]*?<\/article>/;
  if (!article.test(page)) {
    throw new Error('Download page has no Windows article to keep honest.');
  }
  page = page.replace(article, HONEST_WINDOWS_ARTICLE.trim());
  if (claimsSignedOrSha(page)) {
    throw new Error('Download page still claims Signed or SHA-256 after the unprovisioned Windows rewrite.');
  }
  if (!page.includes(WINDOWS_BODY) || !page.includes(WINDOWS_RELEASES_URL) || !page.includes(`>${WINDOWS_CTA}<`)) {
    throw new Error('Download page is missing the unprovisioned Windows Releases copy.');
  }
  return page;
}
