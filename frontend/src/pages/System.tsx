import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Tabs } from '../components/ui';
import { AutomationTab } from './system/AutomationTab';
import { HealthTab } from './system/HealthTab';
import { OptimizeTab } from './system/OptimizeTab';

type SystemTab = 'health' | 'optimize' | 'automation';

const ALL_TABS: { value: SystemTab; label: string }[] = [
  { value: 'health', label: 'Sức khỏe' },
  { value: 'optimize', label: 'Tối ưu' },
  { value: 'automation', label: 'Tự động hóa' }
];

export function System() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const canOps = can('system_ops', 'view');
  const options = canOps ? ALL_TABS : ALL_TABS.slice(0, 1);
  const raw = params.get('tab');
  const found = options.find((option) => option.value === raw);
  const tab: SystemTab = found ? found.value : 'health';

  function handleChange(next: SystemTab) {
    const nextParams = new URLSearchParams(params);
    if (next === 'health') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  }

  return (
    <section className="page">
      <Tabs value={tab} options={options} onChange={handleChange} />
      {tab === 'health' ? <HealthTab /> : null}
      {tab === 'optimize' ? <OptimizeTab /> : null}
      {tab === 'automation' ? <AutomationTab /> : null}
    </section>
  );
}
