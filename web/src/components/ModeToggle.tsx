import { Flame, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ModeToggleProps {
  mode: 'heat' | 'off';
  pending?: boolean;
  onChange: (mode: 'heat' | 'off') => void;
}

function ModeToggle({ mode, pending, onChange }: ModeToggleProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mode</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset className="flex gap-2" aria-label="Heating mode">
          <Button
            className="flex-1"
            variant={mode === 'heat' ? 'default' : 'outline'}
            aria-pressed={mode === 'heat'}
            disabled={pending}
            onClick={() => mode !== 'heat' && onChange('heat')}
          >
            <Flame /> Heat
          </Button>
          <Button
            className="flex-1"
            variant={mode === 'off' ? 'default' : 'outline'}
            aria-pressed={mode === 'off'}
            disabled={pending}
            onClick={() => mode !== 'off' && onChange('off')}
          >
            <Power /> Off
          </Button>
        </fieldset>
      </CardContent>
    </Card>
  );
}

export default ModeToggle;
