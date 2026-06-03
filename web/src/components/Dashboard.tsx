import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Placeholder dashboard. The live data panel (GET /state via TanStack Query)
 * lands in STAT-56.
 */
function Dashboard() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>

      <Card>
        <CardHeader>
          <CardTitle>Current State</CardTitle>
          <CardDescription>Live data coming soon.</CardDescription>
          <CardAction>
            <Badge variant="secondary">auto</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Badge variant="destructive">Boiler On</Badge>
          <span className="text-muted-foreground text-sm">Setpoint: 20°C</span>
          <Spinner className="text-muted-foreground" />
          <Button size="sm" className="ml-auto">
            Refresh
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export default Dashboard;
