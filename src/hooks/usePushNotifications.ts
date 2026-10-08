import { useCallback, useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushStatus,
  type PushStatus,
} from "../lib/pushNotifications";

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await getPushStatus().catch(() => "unsupported" as const));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setStatus(next);
      return next;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { status, busy, enable, disable };
}
