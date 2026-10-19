import AuthGate from '@/components/AuthGate';
import ScheduleEditor from '@/components/ScheduleEditor';

function Schedule() {
  return (
    <AuthGate>
      <ScheduleEditor />
    </AuthGate>
  );
}

export default Schedule;
