import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { logAppError } from '@/lib/logging';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches rendering errors so a broken view cannot leave the native window
 * blank, and reports them through the Rust log.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uncaught render error', error, info.componentStack);

    // Errors caught by a boundary do not trigger window.onerror, so forward
    // them to the Rust log explicitly.
    logAppError(`Uncaught render error: ${error.message}`);
  }

  override render(): ReactNode {
    const { error } = this.state;

    if (error) {
      return <ErrorFallback error={error} />;
    }

    return this.props.children;
  }
}

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="app-background flex h-full flex-col items-center justify-center gap-4 bg-background px-8 text-center text-foreground">
      <Logo className="size-12" />
      <div className="space-y-1.5">
        <h1 className="font-display text-lg font-semibold tracking-tight">
          Что-то сломалось в интерфейсе
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Процесс сервера продолжает работать. Перезагрузите окно, чтобы вернуться к рабочему
          состоянию.
        </p>
      </div>
      <pre className="max-w-xl overflow-auto rounded-lg border border-border/70 bg-muted/40 p-3 text-left font-mono text-[11px] text-muted-foreground">
        {error.message}
      </pre>
      <Button onClick={() => window.location.reload()}>Перезагрузить окно</Button>
    </div>
  );
}
