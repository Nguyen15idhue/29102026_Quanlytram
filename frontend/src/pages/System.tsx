import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../components/ui';
import { AutomationTab } from './system/AutomationTab';
import { HealthTab } from './system/HealthTab';
import { OptimizeTab } from './system/OptimizeTab';

type SystemTab = 'health' | 'optimize' | 'automation';

const TAB_OPTIONS: { value: SystemTab; label: string }[] = [
  { value: 'health', label: 'Sức khỏe' },
  { value: 'optimize', label: 'Tối ưu' },
  { value: 'automation', label: 'Tự động hóa' }
];

function resolveTab(raw: string | null): SystemTab {
  const found = TAB_OPTIONS.find((option) => option.value === raw);
  return found ? found.value : 'health';
}

export function System() {
  const [params, setParams] = useSearchParams();
  const tab = resolveTab(params.get('tab'));

  function handleChange(next: SystemTab) {
    const nextParams = new URLSearchParams(params);
    if (next === 'health') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  }

  return (
    <section className="page">
      <Tabs value={tab} options={TAB_OPTIONS} onChange={handleChange} />
      {tab === 'health' ? <HealthTab /> : null}
      {tab === 'optimize' ? <OptimizeTab /> : null}
      {tab === 'automation' ? <AutomationTab /> : null}
    </section>
  );
}
