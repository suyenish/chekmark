import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Link as RouterDomLink } from 'react-router';

/**
 * Lets every Astryx link and link-button move between screens without a full
 * page load. Addresses on another site, and downloads, stay ordinary links.
 */
export function RouterLink({ href = '', children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || props.target === '_blank' || props.download !== undefined) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  return (
    <RouterDomLink to={href} {...props}>
      {children}
    </RouterDomLink>
  );
}

/** Something went wrong: what, in the server's or the app's own words. Announced to screen readers. */
export function ErrorNote({ message, hint }: { message: string | null; hint?: ReactNode }) {
  if (!message) return null;
  return (
    <span role="alert" className="alert-slot">
      <Banner status="error" title={message} description={hint} collapsible={false} />
    </span>
  );
}
