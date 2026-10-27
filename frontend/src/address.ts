/** Text becomes a search; recognizable hostnames default to HTTPS. Explicit schemes
 * are kept so the backend can reject unsafe protocols rather than search for them.
 */
export function resolveAddress(
  value: string,
  searchProvider: 'google' | 'duckduckgo' = 'google',
): string {
  const input = value.trim();
  if (!input) throw new Error('Enter a website or search terms.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  if (/^[^\s/?#]+\.[^\s/?#]+(?:[/?#].*)?$/.test(input) && !/\s/.test(input))
    return `https://${input}`;
  const url = new URL(
    searchProvider === 'google' ? 'https://www.google.com/search' : 'https://duckduckgo.com/',
  );
  url.searchParams.set('q', input);
  return url.href;
}
