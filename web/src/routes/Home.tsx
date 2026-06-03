import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import AppHeader from '@/components/AppHeader';
import Dashboard from '@/components/Dashboard';
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

function Home() {
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
      <AppHeader onSignOut={() => signOut(auth)} />
      <div className="flex-1">
        <Dashboard />
      </div>
      <Footer />
    </div>
  );
}

export default Home;
