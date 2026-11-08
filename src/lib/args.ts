/**
 * Preview of the dedicated-server launch arguments.
 *
 * The Rust core builds and validates the real command line (fixed order); this
 * module mirrors that order so the UI can show and explain the arguments that
 * will be used. It is a pure function and therefore easy to test.
 */

import { WORLD_SET_KEY_ORDER } from '@/lib/set-keys';
import type { AppConfig } from '@/lib/types';

/**
 * Builds the argument list in the contract order:
 * `-name`, `-port`, `-world`, `-password`, `-public`, `-savedir`, `-logfile`,
 * `-crossplay`, `-preset`, `-modifier` pairs, `-setkey` pairs, `-saveinterval`,
 * extra args.
 *
 * `-nographics`/`-batchmode` are prepended because the dedicated server is
 * headless; for `preset: 'custom'` the individual `-modifier` pairs replace
 * `-preset`. World cheat keys are emitted in a stable order before
 * `-saveinterval` (§6 of the contract).
 */
export function buildServerArgs(
  config: AppConfig,
  paths: { saveDir: string },
  logFile: string | null = null,
): string[] {
  const server = config.server;
  const args: string[] = [
    '-nographics',
    '-batchmode',
    '-name',
    server.name,
    '-port',
    String(server.port),
    '-world',
    server.world,
    '-password',
    server.password,
    '-public',
    server.isPublic ? '1' : '0',
    '-savedir',
    paths.saveDir,
  ];

  if (logFile) {
    args.push('-logfile', logFile);
  }

  if (server.crossplay) {
    args.push('-crossplay');
  }

  if (server.preset === 'custom') {
    const { modifiers } = server;

    args.push(
      '-modifier',
      'combat',
      modifiers.combat,
      '-modifier',
      'deathpenalty',
      modifiers.deathPenalty,
      '-modifier',
      'resources',
      modifiers.resources,
      '-modifier',
      'raids',
      modifiers.raids,
      '-modifier',
      'portals',
      modifiers.portals,
    );
  } else {
    args.push('-preset', server.preset);
  }

  const setKeys = new Set(server.setKeys);

  for (const key of WORLD_SET_KEY_ORDER) {
    if (setKeys.has(key)) {
      args.push('-setkey', key);
    }
  }

  if (server.saveIntervalSec !== null) {
    args.push('-saveinterval', String(server.saveIntervalSec));
  }

  args.push(...server.extraArgs);

  return args;
}

/** Quotes a single argument the way a Windows command line expects it. */
export function quoteArgument(argument: string): string {
  if (argument === '') {
    return '""';
  }

  return /[\s"]/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument;
}

/** Joins the executable and arguments into a copyable command line. */
export function formatCommandLine(executable: string, args: readonly string[]): string {
  return [quoteArgument(executable), ...args.map((argument) => quoteArgument(argument))].join(' ');
}

/** Маска пароля для предпросмотра командной строки (без изменения самих данных). */
export const COMMAND_LINE_PASSWORD_MASK = '••••••';

/**
 * Путь лог-файла сервера для предпросмотра аргументов запуска.
 *
 * В отличие от шаблонов ядра, подставляет реальную дату/время и каталог логов,
 * чтобы в UI не появлялись плейсхолдеры вида `{date}`/`{data_dir}`.
 */
export function buildServerLogFilePath(logsDir: string, now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const baseDir = logsDir.replace(/[\\/]+$/, '');

  return `${baseDir}\\server\\server-${stamp}.log`;
}

/**
 * Копия аргументов с замаскированным значением `-password` — для показа в UI.
 *
 * Пароль не меняется в конфиге; маска используется только в предпросмотре
 * командной строки, чтобы он не попадал на скриншоты/демонстрацию экрана.
 */
export function maskServerArgs(args: readonly string[], password: string): string[] {
  if (password.length === 0) {
    return [...args];
  }

  return args.map((argument, index) =>
    index > 0 && args[index - 1] === '-password' ? COMMAND_LINE_PASSWORD_MASK : argument,
  );
}
