import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Live thermostat panel: fetches GET /state via TanStack Query (oRPC) and
 * renders the boiler/setpoint/mode. The response is zod-validated by the
 * contract before it reaches here.
 */
function CurrentStatePanel() {
  const { data, isLoading, isError, error } = useQuery(orpc.getState.queryOptions());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current State</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Spinner className="text-muted-foreground" />}

        {isError && <p className="text-destructive text-sm">Error: {error.message}</p>}

        {!isLoading && !isError && !data && (
          <p className="text-muted-foreground text-sm">No data</p>
        )}

        {!isLoading && !isError && data && (
          <div className="flex flex-col gap-2">
            <Badge variant={data.boilerActive ? 'destructive' : 'secondary'}>
              {data.boilerActive ? 'Boiler On' : 'Boiler Off'}
            </Badge>
            {data.setpoint !== undefined && <p className="text-sm">Setpoint: {data.setpoint}°C</p>}
            {data.mode && <p className="text-sm">Mode: {data.mode}</p>}
            {data.updatedAt && (
              <p className="text-muted-foreground text-xs">
                Updated: {new Date(data.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CurrentStatePanel;
