import { Terminal } from 'lucide-react';

import { CopyButton } from '@/components/ui/copy-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useServer } from '@/hooks/use-server';
import { buildServerArgs, formatCommandLine } from '@/lib/args';

/** Read-only preview of the command line the Rust core will spawn. */
export function LaunchArgumentsCard() {
  const { data } = useServer();

  if (!data.config || !data.paths) {
    return null;
  }

  const logFile = `${data.paths.logsDir}\\server\\server-<дата>-<время>.log`;
  const args = buildServerArgs(data.config, { saveDir: data.paths.saveDir }, logFile);
  const executable =
    data.installStatus?.serverExePath ?? `${data.config.installDir}\\valheim_server.exe`;
  const commandLine = formatCommandLine(executable, args);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-3.5 text-primary" aria-hidden="true" />
            Аргументы запуска
          </CardTitle>
          <CardDescription>
            Предпросмотр строки, которую сформирует ядро при запуске сервера.
          </CardDescription>
        </div>
        <CopyButton value={commandLine} label="Копировать командную строку" />
      </CardHeader>
      <CardContent className="space-y-2">
        <pre className="max-h-52 overflow-auto rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-foreground/90">
          {commandLine}
        </pre>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Флаги <span className="font-mono">-savedir</span>,{' '}
          <span className="font-mono">-logfile</span> и{' '}
          <span className="font-mono">-saveinterval</span> добавляет менеджер; дополнительные
          аргументы ({data.config.server.extraArgs.length}) выводятся в конце.
        </p>
      </CardContent>
    </Card>
  );
}
