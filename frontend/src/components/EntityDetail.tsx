import type { ReactNode } from 'react';
import { Tabs } from './ui';

export type EntityDetailTab = 'overview' | 'data' | 'quality' | 'history';

export const ENTITY_DETAIL_TABS: Array<{ value: EntityDetailTab; label: string }> = [
  { value: 'overview', label: 'Tổng quan' },
  { value: 'data', label: 'Dữ liệu' },
  { value: 'quality', label: 'Chất lượng' },
  { value: 'history', label: 'Lịch sử' }
];

export function parseEntityDetailTab(value: string | null | undefined): EntityDetailTab {
  return ENTITY_DETAIL_TABS.some((tab) => tab.value === value)
    ? (value as EntityDetailTab)
    : 'overview';
}

export function EntityDetail({
  health,
  tab,
  onTabChange,
  sections
}: {
  health: ReactNode;
  tab: EntityDetailTab;
  onTabChange: (tab: EntityDetailTab) => void;
  sections: Partial<Record<EntityDetailTab, ReactNode>>;
}) {
  return (
    <div className="entity-detail">
      {health}
      <Tabs value={tab} options={ENTITY_DETAIL_TABS} onChange={onTabChange} />
      <div className="entity-detail-body">{sections[tab] ?? null}</div>
    </div>
  );
}
