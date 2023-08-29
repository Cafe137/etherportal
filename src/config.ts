import { Arrays, Dates } from 'cafe-utility'

const str = Arrays.getArgument
const num = Arrays.getNumberArgument
const bool = Arrays.getBooleanArgument
const argv = process.argv
const env = process.env as Record<string, string>

export const config = {
  beeApiUrl: str(argv, 'bee-api-url', env, 'BEE_API_URL') || 'http://localhost:1633',
  beeDebugApiUrl: str(argv, 'bee-debug-api-url', env, 'BEE_DEBUG_API_URL') || 'http://localhost:1635',
  hostname: str(argv, 'hostname', env, 'HOSTNAME') || 'localhost',
  port: num(argv, 'port', env, 'PORT') || 3000,
  authorization: str(argv, 'auth-secret', env, 'AUTH_SECRET'),
  cidSubdomains: bool(argv, 'cid-subdomains', env, 'CID_SUBDOMAINS') ?? false,
  ensSubdomains: bool(argv, 'ens-subdomains', env, 'ENS_SUBDOMAINS') ?? false,
  removePinHeader: bool(argv, 'remove-pin-header', env, 'REMOVE_PIN_HEADER') ?? true,
  stamp: str(argv, 'stamp', env, 'STAMP'),
  mode: str(argv, 'mode', env, 'MODE'),
  depth: num(argv, 'depth', env, 'DEPTH'),
  amount: str(argv, 'amount', env, 'AMOUNT'),
  usageThreshold: num(argv, 'usage-threshold', env, 'USAGE_THRESHOLD') ?? 0.7,
  usageMax: num(argv, 'usage-max', env, 'USAGE_MAX') ?? 0.9,
  ttlMin: num(argv, 'ttl-min', env, 'TTL_MIN') || Dates.minutes(15) / 1000,
  refreshPeriod: num(argv, 'refresh-period', env, 'REFRESH_PERIOD') || Dates.minutes(5),
  reupload: bool(argv, 'reupload', env, 'REUPLOAD') ?? false,
}

export function requireHardcodedConfig() {
  if (!config.stamp) {
    throw new Error('Hardcoded stamp mode requires --stamp or STAMP to be set')
  }

  return {
    stamp: config.stamp,
  }
}

export function requireAutobuyConfig() {
  if (!config.depth || !config.amount) {
    throw new Error('Autobuy stamp mode requires --depth or DEPTH and --amount or AMOUNT to be set')
  }

  return {
    depth: config.depth,
    amount: config.amount,
  }
}

export const SUPPORTED_LEVELS = ['critical', 'error', 'warn', 'info', 'verbose', 'debug'] as const
export type SupportedLevels = typeof SUPPORTED_LEVELS[number]

export const ERROR_NO_STAMP = 'No postage stamp'

export const logLevel =
  process.env.LOG_LEVEL && SUPPORTED_LEVELS.includes(process.env.LOG_LEVEL as SupportedLevels)
    ? process.env.LOG_LEVEL
    : 'info'
