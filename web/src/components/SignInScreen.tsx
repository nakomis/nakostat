import logo from '@/assets/nakostat-logo.png';
import { Button } from '@/components/ui/button';

interface SignInScreenProps {
  onSignIn: () => void;
}

function SignInScreen({ onSignIn }: SignInScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <img src={logo} alt="Nakostat logo" className="h-24 w-24" />
      <div>
        <h1 className="text-2xl font-semibold">Nakostat</h1>
        <p className="text-muted-foreground text-sm">Smart thermostat dashboard</p>
      </div>
      <Button onClick={onSignIn}>Sign in</Button>
    </div>
  );
}

export default SignInScreen;
