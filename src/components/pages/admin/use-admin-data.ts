import { useCallback, useEffect, useState } from 'react';

/** Сколько ждём данные таба, прежде чем показать empty-state вместо skeleton. */
export const ADMIN_DATA_TIMEOUT_MS = 8000;

export interface AdminDataLoadState {
  /** Данных ещё нет, но таймаут не истёк — показываем skeleton. */
  loading: boolean;
  /** Данные не пришли за таймаут — показываем empty-state с «Обновить». */
  failed: boolean;
  /** Повторный запрос данных. */
  retry: () => void;
}

/**
 * Локальный loading-статус таба: не зависит от глобального `store.status`.
 *
 * Если `hasData` уже `true`, ничего не запрашивается. Иначе — один запрос при
 * монтировании/повторе и таймаут: через `timeoutMs` таб перестаёт показывать
 * skeleton и предлагает обновить данные (защита от «вечного» ожидания).
 */
export function useAdminDataTimeout(
  hasData: boolean,
  request: () => Promise<unknown>,
  timeoutMs: number = ADMIN_DATA_TIMEOUT_MS,
): AdminDataLoadState {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (hasData || failed) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setFailed(true);
    }, timeoutMs);

    void request().catch(() => {
      setFailed(true);
    });

    return () => {
      clearTimeout(timer);
    };
  }, [failed, hasData, request, timeoutMs]);

  // Сброс failed перезапускает эффект выше — он повторит запрос.
  const retry = useCallback(() => {
    setFailed(false);
  }, []);

  return { loading: !hasData && !failed, failed, retry };
}
