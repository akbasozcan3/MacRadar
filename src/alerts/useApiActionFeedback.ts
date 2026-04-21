import { useCallback } from 'react';

import { isApiRequestError } from '../services/apiClient';
import {
  type AlertToastOptions,
  useAlert,
} from './AlertProvider';

type ErrorToastOptions = Omit<AlertToastOptions, 'message' | 'tone'> & {
  fallbackMessage: string;
  tone?: 'danger' | 'warning';
};

type SuccessToastOptions = AlertToastOptions;

type ApiActionFeedbackOptions<TResult> = {
  action: () => Promise<TResult>;
  errorToast?: ErrorToastOptions;
  onError?: (error: unknown) => void;
  onSuccess?: (result: TResult) => void;
  successToast?: SuccessToastOptions;
};

export function useApiActionFeedback() {
  const { showToast } = useAlert();

  const resolveErrorMessage = useCallback((error: unknown, fallbackMessage: string) => {
    return isApiRequestError(error) ? error.message : fallbackMessage;
  }, []);

  const notifyApiError = useCallback(
    (error: unknown, options: ErrorToastOptions) => {
      showToast({
        durationMs: options.durationMs,
        message: resolveErrorMessage(error, options.fallbackMessage),
        title: options.title,
        tone: options.tone ?? 'danger',
      });
    },
    [resolveErrorMessage, showToast],
  );

  const notifySuccess = useCallback(
    (options: SuccessToastOptions) => {
      showToast({
        durationMs: options.durationMs,
        message: options.message,
        title: options.title,
        tone: options.tone ?? 'success',
      });
    },
    [showToast],
  );

  const runWithFeedback = useCallback(
    async <TResult,>(options: ApiActionFeedbackOptions<TResult>) => {
      try {
        const result = await options.action();
        if (options.successToast) {
          notifySuccess(options.successToast);
        }
        options.onSuccess?.(result);
        return result;
      } catch (error) {
        if (options.errorToast) {
          notifyApiError(error, options.errorToast);
        }
        options.onError?.(error);
        throw error;
      }
    },
    [notifyApiError, notifySuccess],
  );

  return {
    notifyApiError,
    notifySuccess,
    resolveErrorMessage,
    runWithFeedback,
  };
}
