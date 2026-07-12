import { useMemo, useSyncExternalStore } from 'react';
import { OnlineController, type OnlineView } from './controller';

/** One controller per mount; the view is an immutable snapshot per emit. */
export function useOnlineRoom(myName: string): { view: OnlineView; ctl: OnlineController } {
  const ctl = useMemo(() => new OnlineController(myName), [myName]);
  const view = useSyncExternalStore(ctl.subscribe, ctl.getView, ctl.getView);
  return { view, ctl };
}
