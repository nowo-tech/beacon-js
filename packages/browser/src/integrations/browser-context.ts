import type { BeaconEvent, Integration } from '@nowo-tech/beacon-core';

interface UaData {
  brands?: Array<{ brand: string; version: string }>;
  platform?: string;
}

/** Minimal user-agent parse: browser name and major version, OS name. */
export function parseUserAgent(ua: string): {
  browser?: { name: string; version: string };
  os?: { name: string };
} {
  const out: { browser?: { name: string; version: string }; os?: { name: string } } = {};
  const rules: Array<[string, RegExp]> = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/],
  ];
  for (const [name, pattern] of rules) {
    const match = pattern.exec(ua);
    if (match) {
      out.browser = { name, version: match[1]! };
      break;
    }
  }
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'Chrome OS'
            : /Linux/.test(ua)
              ? 'Linux'
              : undefined;
  if (os) out.os = { name: os };
  return out;
}

/** `contexts.browser` / `os` from `navigator.userAgentData` or a minimal UA parse, and the page URL. */
export function browserContextIntegration(): Integration {
  return {
    name: 'BrowserContext',
    processEvent(event: BeaconEvent) {
      const ua = navigator.userAgent;
      const parsed = parseUserAgent(ua);
      const data = (navigator as Navigator & { userAgentData?: UaData }).userAgentData;
      const brand = data?.brands?.find((item) => !/Not.?A.?Brand|Chromium/i.test(item.brand));
      if (brand)
        parsed.browser = {
          name: brand.brand.replace(/^Google |^Microsoft /, ''),
          version: brand.version,
        };
      if (data?.platform) parsed.os = { name: data.platform };
      event.contexts = { ...parsed, ...event.contexts };
      event.request = { url: location.href, headers: { 'User-Agent': ua }, ...event.request };
      return event;
    },
  };
}
