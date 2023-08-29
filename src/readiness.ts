import { Utils } from '@ethersphere/bee-js'
import { bee, beeDebug } from './bee'
import { ERROR_NO_STAMP } from './config'
import { logger } from './logger'
import { StampsManager } from './stamps'

const MAX_CHUNK_SIZE = 4096
const READINESS_TIMEOUT_MS = 3_000

export enum ReadinessStatus {
  OK = 'OK',
  NO_STAMP = 'NO_STAMP',
  HEALTH_CHECK_FAILED = 'HEALTH_CHECK_FAILED',
  OTHER_ERROR = 'OTHER_ERROR',
}

export async function checkReadiness(stampManager?: StampsManager): Promise<ReadinessStatus> {
  if (stampManager) {
    const ready = await tryUploadingSingleChunk(stampManager)

    return ready
  } else {
    try {
      const health = await beeDebug.getHealth({ timeout: 3_000 })
      const ready = health.status === 'ok'

      return ready ? ReadinessStatus.OK : ReadinessStatus.HEALTH_CHECK_FAILED
    } catch {
      return ReadinessStatus.OTHER_ERROR
    }
  }
}

async function tryUploadingSingleChunk(stampsManager: StampsManager): Promise<ReadinessStatus> {
  const chunk = makeChunk()
  try {
    await bee.uploadChunk(stampsManager.postageStamp, chunk, { deferred: true }, { timeout: READINESS_TIMEOUT_MS })

    return ReadinessStatus.OK
  } catch (error: any) {
    logger.error('unable to upload readiness-check chunk to bee', error)

    return error.message === ERROR_NO_STAMP ? ReadinessStatus.NO_STAMP : ReadinessStatus.OTHER_ERROR
  }
}

function makeChunk(seed = '', length = MAX_CHUNK_SIZE): Uint8Array {
  if (length > MAX_CHUNK_SIZE) {
    throw Error(`Chunk length cannot be greater than ${MAX_CHUNK_SIZE}`)
  }
  const data = Buffer.alloc(length)
  let random: Uint8Array = Buffer.from(seed || getDefaultSeed())
  let offset = 0
  while (offset < length) {
    random = Utils.keccak256Hash(random)

    if (length - offset < 32) {
      random = random.slice(0, length - offset)
    }
    data.set(random, offset)
    offset += random.length
  }

  return data
}

function getDefaultSeed(): string {
  // e.g. 2022-09-08T10
  return new Date().toISOString().slice(0, 13)
}
