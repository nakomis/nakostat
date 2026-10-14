import { useEffect, useState } from 'react';
import { fetchDeployedVersion, trackerEnvironment } from '@/api/deployment-tracker';
import { Badge } from '@/components/ui/badge';
import Config, { resolveTrackerUrl } from '@/config/config';
import versionData from '@/version.json';

/** Deployed version from the tracker, or `null` until (or unless) it is known. */
export function useDeployedVersion(): string | null {
  const [deployed, setDeployed] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchDeployedVersion({
      baseUrl: resolveTrackerUrl(Config),
      environment: trackerEnvironment(Config.env),
      signal: controller.signal,
    }).then((version) => {
      if (!controller.signal.aborted) setDeployed(version);
    });
    return () => controller.abort();
  }, []);

  return deployed;
}

function Footer() {
  const deployed = useDeployedVersion();

  return (
    <footer className="text-muted-foreground flex items-center justify-center gap-2 border-t px-4 py-3 text-center text-xs">
      <span>v{versionData.version} · Nakostat</span>
      {deployed && (
        <Badge variant="outline" title="Version recorded by the deployment tracker">
          deployed v{deployed}
        </Badge>
      )}
    </footer>
  );
}

export default Footer;
