import type { ReactNode } from 'react';
import logo from '@/assets/nakostat-logo.png';
import { Button } from '@/components/ui/button';

interface AppHeaderProps {
  onSignOut: () => void;
  /** Navigation links, shown between the title and the sign-out button. */
  nav?: ReactNode;
}

function AppHeader({ onSignOut, nav }: AppHeaderProps) {
  return (
    <header className="flex items-center gap-3 border-b px-4 py-3">
      <img src={logo} alt="Nakostat" className="h-9 w-9" />
      <span className="text-lg font-semibold">Nakostat</span>
      <nav aria-label="Main" className="flex flex-1 items-center gap-4 pl-4">
        {nav}
      </nav>
      <Button variant="outline" size="sm" onClick={onSignOut}>
        Sign out
      </Button>
    </header>
  );
}

export default AppHeader;
