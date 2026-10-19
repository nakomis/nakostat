import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import AppHeader from '@/components/AppHeader';
import Footer from '@/components/Footer';
import SignInScreen from '@/components/SignInScreen';
import { Spinner } from '@/components/ui/spinner';
import { signOut } from '@/lib/auth';

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex min-h-screen items-center justify-center gap-2 p-8">
      {children}
    </div>
  );
}

const linkClass = 'text-muted-foreground hover:text-foreground text-sm';
const activeClass = { className: 'text-foreground text-sm font-medium' };

/** Auth states plus the signed-in page chrome (header with navigation, footer). */
function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <CenteredMessage>
        <Spinner /> Loading…
      </CenteredMessage>
    );
  }

  if (auth.error) {
    return <CenteredMessage>Error: {auth.error.message}</CenteredMessage>;
  }

  if (!auth.isAuthenticated) {
    return <SignInScreen onSignIn={() => void auth.signinRedirect()} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        onSignOut={() => signOut(auth)}
        nav={
          <>
            <Link to="/" className={linkClass} activeProps={activeClass}>
              Dashboard
            </Link>
            <Link to="/schedule" className={linkClass} activeProps={activeClass}>
              Schedule
            </Link>
          </>
        }
      />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}

export default AuthGate;
