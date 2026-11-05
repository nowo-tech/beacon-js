import { getCurrentScope, scrubUrl, type Client, type Integration } from '@nowo-tech/beacon-core';

export interface ResourceErrorsOptions {
  /** `breadcrumb` (default) or `event` (level `warning`). */
  mode?: 'breadcrumb' | 'event';
  /** Report `<img>` failures too (off by default: noise). */
  images?: boolean;
}

const TAGS = ['SCRIPT', 'LINK', 'VIDEO', 'AUDIO', 'IMG'];

/** Failed `<script>`, `<link>`, `<video>`, `<audio>` (and optionally `<img>`) loads (contract §7.2). */
export function resourceErrorsIntegration(options: ResourceErrorsOptions = {}): Integration {
  let remove: (() => void) | undefined;
  return {
    name: 'ResourceErrors',
    setup(client: Client) {
      const onError = (event: Event): void => {
        const target = event.target as (Element & { src?: string; href?: string }) | null;
        const tag = target?.tagName;
        if (!tag || !TAGS.includes(tag) || (tag === 'IMG' && !options.images)) return;
        const url = scrubUrl(String(target.src || target.href || ''));
        const name = tag.toLowerCase();
        if (options.mode === 'event') {
          client.captureMessage(
            `Failed to load <${name}> ${url}`,
            getCurrentScope(),
            'warning',
            { extra: { url, tag: name } },
            { logger: 'resource' },
          );
        } else {
          client.addBreadcrumb(
            {
              category: 'resource',
              level: 'error',
              message: `<${name}> failed to load`,
              data: { url, tag: name },
            },
            getCurrentScope(),
          );
        }
      };
      addEventListener('error', onError, true);
      remove = () => removeEventListener('error', onError, true);
    },
    teardown() {
      remove?.();
    },
  };
}
