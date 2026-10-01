type Fields = Record<string, unknown>

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
}

/** GitHub Actions annotations, so a failure is visible in the run summary. */
export function ghError(message: string): void {
  if (process.env['GITHUB_ACTIONS']) console.log(`::error::${message}`)
}
