import type { ReactNode } from 'react';
import { LinkProvider } from '@astryxdesign/core/Link';
import { Theme } from '@astryxdesign/core/theme';
import { MemoryRouter } from 'react-router';
import { type Api, ApiContext } from './api';
import { themes, defaultThemeSlug } from './astryx-themes';
import { RouterLink } from './ui';

/** Everything a screen needs around it in a test: a fake API, a router, and the theme and links of the real app. */
export function TestApp({ api, path = '/', children }: { api: Partial<Api>; path?: string; children: ReactNode }) {
  return (
    <ApiContext.Provider value={api as Api}>
      <Theme theme={themes[defaultThemeSlug]} mode="light">
        <MemoryRouter initialEntries={[path]}>
          <LinkProvider component={RouterLink}>{children}</LinkProvider>
        </MemoryRouter>
      </Theme>
    </ApiContext.Provider>
  );
}
