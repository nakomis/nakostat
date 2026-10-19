import AuthGate from '@/components/AuthGate';
import Dashboard from '@/components/Dashboard';

function Home() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}

export default Home;
