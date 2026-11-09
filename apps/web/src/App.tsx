import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router';
import { messageOf, type User, useApi } from './api';
import { BookPages, Books } from './pages/Books';
import { Capture } from './pages/Capture';
import { PageScreen } from './pages/PageScreen';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { ItemScreen, WordBank } from './pages/WordBank';

function Header({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  return (
    <header>
      <div className="topbar">
        <Link className="wordmark" to="/" lang="ko">
          책마크
        </Link>
        <span className="beta">Beta</span>
        <span className="spacer" />
        {user && (
          <button type="button" className="quiet-button" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
      {user && (
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Books
          </NavLink>
          <NavLink to="/wordbank">Word bank</NavLink>
          <NavLink to="/review">Review</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      )}
    </header>
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

  const signedIn = useCallback((next: User) => setUser(next), []);

  async function signOut() {
    await api.logout().catch(() => undefined);
    setUser(null);
    navigate('/sign-in');
  }

  return (
    <div className="shell">
      <Header user={user ?? null} onSignOut={signOut} />
      <main>
        {error ? (
          <p className="error">{error}</p>
        ) : user === undefined ? (
          <p className="note">Loading…</p>
        ) : (
          <Routes>
            <Route path="/sign-in" element={<SignIn onSignedIn={signedIn} />} />
            {user ? (
              <>
                <Route path="/" element={<Books />} />
                <Route path="/books/:bookId" element={<BookPages />} />
                <Route path="/books/:bookId/capture" element={<Capture />} />
                <Route path="/pages/:pageId" element={<PageRoute />} />
                <Route path="/wordbank" element={<WordBank />} />
                <Route path="/wordbank/:itemId" element={<ItemScreen />} />
                <Route path="/review" element={<Review />} />
                <Route
                  path="/settings"
                  element={
                    <Settings
                      email={user.email}
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
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
