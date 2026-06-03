import CurrentStatePanel from '@/components/CurrentStatePanel';

/** Signed-in landing page: live thermostat state and (later) controls. */
function Dashboard() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>
      <CurrentStatePanel />
    </main>
  );
}

export default Dashboard;
