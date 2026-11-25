import { useCallback, useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Link as TextLink, LinkProvider } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Theme } from '@astryxdesign/core/theme';
import { VStack } from '@astryxdesign/core/VStack';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { messageOf, SIGNED_OUT_EVENT, type User, useApi } from './api';
import { defaultThemeSlug, themes } from './astryx-themes';
import { BookPages, Books } from './pages/Books';
import { Capture } from './pages/Capture';
import { PageScreen } from './pages/PageScreen';
import { Privacy } from './pages/Privacy';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { ItemScreen, WordBank } from './pages/WordBank';
import { ErrorNote, RouterLink } from './ui';

/** Which tab the current address belongs to. Pages and capture are part of Books. */
function sectionOf(pathname: string): string {
  if (pathname.startsWith('/wordbank')) return 'wordbank';
  if (pathname.startsWith('/review')) return 'review';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'books';
}

function Header({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <VStack gap={1} paddingBlockStart={4} paddingBlockEnd={6}>
      <HStack gap={2} vAlign="center" hAlign="between">
        <HStack gap={2} vAlign="center">
          <Link className="wordmark" to="/" lang="ko" aria-label="책마크 Chekmark, home">
            책마크
          </Link>
          <Badge label="Beta" variant="yellow" />
        </HStack>
        {user && <Button label="Sign out" variant="ghost" size="sm" onClick={onSignOut} />}
      </HStack>
      {user && (
        <nav aria-label="Main">
          <TabList value={sectionOf(pathname)} onChange={(value) => navigate(value === 'books' ? '/' : `/${value}`)} hasDivider layout="fill" size="sm">
            <Tab value="books" label="Books" href="/" />
            <Tab value="wordbank" label="Words" href="/wordbank" />
            <Tab value="review" label="Review" href="/review" />
            <Tab value="settings" label="Settings" href="/settings" />
          </TabList>
        </nav>
      )}
    </VStack>
  );
}

function PageRoute() {
  const { pageId = '' } = useParams();
  return <PageScreen key={pageId} pageId={pageId} />;
}

function AppRoutes() {
  const api = useApi();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setUser, (e: unknown) => setError(messageOf(e)));
  }, [api]);

  // Any request that finds the session gone (expired, or signed out elsewhere) sends the reader to sign in.
  useEffect(() => {
    const signedOut = () => setUser(null);
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, []);

  const signedIn = useCallback((next: User) => setUser(next), []);

  async function signOut() {
    await api.logout().catch(() => undefined);
    setUser(null);
    navigate('/sign-in');
  }

  return (
    <div className="shell">
      <Header user={user ?? null} onSignOut={signOut} />
      {user?.demo && (
        <div className="demo-note">
          <Banner status="info" title="You are in the demo" description="Sample pages with saved explanations, in your own temporary account. It is deleted after 24 hours." collapsible={false} />
        </div>
      )}
      <main>
        {error ? (
          <ErrorNote message={error} hint="Reload the page to try again." />
        ) : user === undefined ? (
          <Spinner size="lg" aria-label="Loading Chekmark" />
        ) : (
          <Routes>
            <Route path="/sign-in" element={user ? <Navigate to="/" replace /> : <SignIn onSignedIn={signedIn} />} />
            <Route path="/privacy" element={<Privacy />} />
            {user ? (
              <>
                <Route path="/" element={<Books />} />
                <Route path="/books/:bookId" element={<BookPages />} />
                <Route path="/books/:bookId/capture" element={<Capture demo={user.demo} />} />
                <Route path="/pages/:pageId" element={<PageRoute />} />
                <Route path="/wordbank" element={<WordBank />} />
                <Route path="/wordbank/:itemId" element={<ItemScreen />} />
                <Route path="/review" element={<Review />} />
                <Route
                  path="/settings"
                  element={
                    <Settings
                      email={user.demo ? 'a demo visitor' : user.email}
                      onDeleted={() => {
                        setUser(null);
                        navigate('/sign-in', { replace: true });
                      }}
                    />
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            ) : (
              <Route path="*" element={<Navigate to="/sign-in" replace />} />
            )}
          </Routes>
        )}
      </main>
      <footer>
        <HStack gap={4} paddingBlockStart={8}>
          <TextLink href="/privacy" size="sm">
            Privacy
          </TextLink>
        </HStack>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <Theme theme={themes[defaultThemeSlug]}>
      <BrowserRouter>
        <LinkProvider component={RouterLink}>
          <AppRoutes />
        </LinkProvider>
      </BrowserRouter>
    </Theme>
  );
}
