import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '../auth/AuthProvider';
import type {
  QualityAlertItem,
  QualityLiveItem,
  RealtimeAlert,
  RealtimeConnection,
  RealtimeRelay,
  RealtimeSnapshot
} from '../types';

interface RealtimeContextValue {
  snapshot: RealtimeSnapshot | null;
  quality: QualityLiveItem[];
  qualityAlerts: QualityAlertItem[];
  lastQualityAck: { alertId: number; webUserId: number; ts: string } | null;
  connected: boolean;
  revoked: boolean;
  lastSession: { jobId: number; id: number; closeReason: string } | null;
  refresh: () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function relaySummary(items: RealtimeRelay[], previous: RealtimeSnapshot['summary']) {
  return {
    ...previous,
    relayTotal: items.length,
    relayStreaming: items.filter((item) => item.state === 'streaming').length,
    relayBackoff: items.filter((item) => item.state === 'backoff').length,
    relayError: items.filter((item) => item.state === 'error').length,
    relayPending: items.filter(
      (item) => item.state === 'pending' || item.state === 'connecting'
    ).length
  };
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot | null>(null);
  const [quality, setQuality] = useState<QualityLiveItem[]>([]);
  const [qualityAlerts, setQualityAlerts] = useState<QualityAlertItem[]>([]);
  const [lastQualityAck, setLastQualityAck] =
    useState<RealtimeContextValue['lastQualityAck']>(null);
  const [connected, setConnected] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [lastSession, setLastSession] = useState<RealtimeContextValue['lastSession']>(null);

  useEffect(() => {
    if (!user) {
      setSnapshot(null);
      setQuality([]);
      setQualityAlerts([]);
      setLastQualityAck(null);
      setConnected(false);
      setRevoked(false);
      return;
    }
    const instance = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000
    });
    setSocket(instance);

    instance.on('connect', () => {
      setConnected(true);
      setRevoked(false);
      instance.emit('snapshot:request');
    });
    instance.on('disconnect', () => setConnected(false));
    instance.on('connect_error', () => setConnected(false));
    instance.on('auth.revoked', () => {
      setRevoked(true);
      setConnected(false);
      setSnapshot(null);
    });
    instance.on('snapshot', (payload: RealtimeSnapshot) => setSnapshot(payload));
    instance.on('relay.updated', (payload: { ts: string; items: RealtimeRelay[] }) => {
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              ts: payload.ts,
              relays: payload.items,
              summary: relaySummary(payload.items, previous.summary)
            }
          : previous
      );
    });
    instance.on('connection.updated', (payload: { ts: string; items: RealtimeConnection[] }) => {
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              ts: payload.ts,
              connections: payload.items,
              summary: { ...previous.summary, connections: payload.items.length }
            }
          : previous
      );
    });
    instance.on('alert.created', (payload: { ts: string; items: RealtimeAlert[] }) => {
      setSnapshot((previous) => {
        if (!previous) return previous;
        const known = new Set(previous.alerts.map((alert) => alert.id));
        const added = payload.items.filter((alert) => !known.has(alert.id));
        return {
          ...previous,
          ts: payload.ts,
          alerts: [...added, ...previous.alerts],
          summary: { ...previous.summary, openAlerts: previous.summary.openAlerts + added.length }
        };
      });
    });
    instance.on(
      'relay.session',
      (payload: { session: { id: number; jobId: number; closeReason: string } }) => {
        setLastSession(payload.session);
      }
    );
    instance.on('quality.snapshot', (payload: { items: QualityLiveItem[] }) => {
      setQuality(payload.items ?? []);
    });
    instance.on('quality.updated', (payload: { items: QualityLiveItem[] }) => {
      setQuality(payload.items ?? []);
    });
    instance.on('quality.alert', (payload: { items: QualityAlertItem[] }) => {
      setQualityAlerts((previous) => {
        const known = new Set(previous.map((alert) => alert.id));
        return [...(payload.items ?? []).filter((alert) => !known.has(alert.id)), ...previous];
      });
    });
    instance.on(
      'quality.alert.ack',
      (payload: { alertId: number; webUserId: number; ts: string }) => {
        setLastQualityAck(payload);
        setQualityAlerts((previous) =>
          previous.map((alert) =>
            alert.id === payload.alertId
              ? { ...alert, ackedAt: payload.ts, ackedBy: payload.webUserId }
              : alert
          )
        );
      }
    );

    return () => {
      instance.disconnect();
      setSocket(null);
    };
  }, [user]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      snapshot,
      quality,
      qualityAlerts,
      lastQualityAck,
      connected,
      revoked,
      lastSession,
      refresh: () => socket?.emit('snapshot:request')
    }),
    [snapshot, quality, qualityAlerts, lastQualityAck, connected, revoked, lastSession, socket]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used within RealtimeProvider');
  return value;
}
