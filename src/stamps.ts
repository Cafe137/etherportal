import { BatchId, PostageBatch } from '@ethersphere/bee-js'
import { System } from 'cafe-utility'
import client from 'prom-client'
import { beeDebug } from './bee'
import { ERROR_NO_STAMP, config, requireAutobuyConfig, requireHardcodedConfig } from './config'
import { logger } from './logger'
import { register } from './metrics'

const stampPurchaseCounter = new client.Counter({
  name: 'stamp_purchase_counter',
  help: 'How many stamps were purchased',
})
register.registerMetric(stampPurchaseCounter)

const stampPurchaseFailedCounter = new client.Counter({
  name: 'stamp_purchase_failed_counter',
  help: 'How many stamps failed to be purchased',
})
register.registerMetric(stampPurchaseFailedCounter)

const stampCheckCounter = new client.Counter({
  name: 'stamp_check_counter',
  help: 'How many times were stamps retrieved from server',
})
register.registerMetric(stampCheckCounter)

const stampGetCounter = new client.Counter({
  name: 'stamp_get_counter',
  help: 'How many times was get postageStamp called',
})
register.registerMetric(stampGetCounter)

const stampGetErrorCounter = new client.Counter({
  name: 'stamp_get_error_counter',
  help: 'How many times was get postageStamp called and there was no valid postage stamp',
})
register.registerMetric(stampGetErrorCounter)

const stampTtlGauge = new client.Gauge({
  name: 'stamp_ttl_gauge',
  help: 'TTL on the selected automanaged stamp',
})
register.registerMetric(stampTtlGauge)

const stampUsageGauge = new client.Gauge({
  name: 'stamp_usage_gauge',
  help: 'Usage on the selected automanaged stamp',
})
register.registerMetric(stampUsageGauge)

const stampUsableCountGauge = new client.Gauge({
  name: 'stamp_usable_count_gauge',
  help: 'How many stamps exist on the bee node that can be used',
})
register.registerMetric(stampUsableCountGauge)

/**
 * Calculate usage of a given postage stamp
 *
 * @param stamp Postage stamp which usage should be determined
 */
export function getUsage({ utilization, depth, bucketDepth }: PostageBatch): number {
  return utilization / Math.pow(2, depth - bucketDepth)
}

/**
 * Filter the stamps and only return those that are usable, have correct amount, depth, are not close to beying maxUsage or close to expire
 *
 * @param stamps Postage stamps to be filtered
 * @param depth Postage stamps depth
 * @param amount Postage stamps amount
 * @param maxUsage Maximal usage of the stamp to be usable by the proxy
 * @param minTTL Minimal TTL of the stamp to be usable by the proxy
 *
 * @returns Filtered stamps soltered by usage
 */
export function filterUsableStampsAutobuy(
  stamps: PostageBatch[],
  depth: number,
  amount: string,
  maxUsage: number,
  minTTL: number,
): PostageBatch[] {
  const usableStamps = stamps
    // filter to get stamps that have the right depth, amount and are not fully used or expired
    .filter(s => s.usable && s.depth === depth && s.amount === amount && getUsage(s) < maxUsage && s.batchTTL > minTTL)
    // sort the stamps by usage
    .sort((a, b) => (getUsage(a) < getUsage(b) ? 1 : -1))

  // return the all usable stamp sorted by usage
  return usableStamps
}

/**
 * Filter the stamps and only return those that are usable and sort by from closer to farer expire TTL
 *
 * @param stamps Postage stamps to be filtered
 *
 * @returns Filtered stamps soltered by usage
 */
export function filterUsableStampsExtends(stamps: PostageBatch[]): PostageBatch[] {
  const usableStamps = stamps
    // filter to get stamps that have the right depth, amount and are not fully used or expired
    .filter(s => s.usable)
    // sort the stamps by usage
    .sort((a, b) => (a.batchTTL > b.batchTTL ? 1 : -1))

  // return the all usable stamp sorted by usage
  return usableStamps
}

/**
 * Buy new postage stamp and wait until it is usable
 *
 * @param depth Postage stamps depth
 * @param amount Postage stamps amount
 * @returns Newly bought postage stamp
 */
export async function buyNewStamp(depth: number, amount: string): Promise<{ batchId: BatchId; stamp: PostageBatch }> {
  logger.info('buying new stamp')
  const batchId = await beeDebug.createPostageBatch(amount, depth, { waitForUsable: true })
  stampPurchaseCounter.inc()

  const stamp = await beeDebug.getPostageBatch(batchId)
  logger.info('successfully bought new stamp', { stamp })

  return { batchId, stamp }
}

export async function topUpStamp(postageBatchId: string, amount: string): Promise<PostageBatch> {
  await beeDebug.topUpBatch(postageBatchId, amount)
  const stamp = await beeDebug.getPostageBatch(postageBatchId)

  return stamp
}

export class StampsManager {
  private stamp?: string
  private usableStamps: PostageBatch[] = []

  public start(): StampsManager {
    if (config.mode === 'hardcoded') {
      this.stamp = requireHardcodedConfig().stamp
    } else if (config.mode === 'autobuy') {
      requireAutobuyConfig()
      System.forever(this.refreshStampsAutobuy.bind(this), config.refreshPeriod)
    } else if (config.mode === 'autoextend') {
      requireAutobuyConfig()
      System.forever(this.refreshStampsExtends.bind(this), config.refreshPeriod)
    }

    return this
  }

  /**
   * Get postage stamp that should be replaced in a the proxy request header
   *
   * @return Postage stamp that should be used by the proxy
   *
   * @throws Error if there is no postage stamp
   */
  get postageStamp(): string {
    stampGetCounter.inc()

    if (this.stamp) {
      const stamp = this.stamp
      logger.info('using hardcoded stamp', { stamp })

      return stamp
    }

    if (this.usableStamps[0]) {
      const stamp = this.usableStamps[0]
      logger.info('using autobought stamp', { stamp })

      return stamp.batchID
    }

    stampGetErrorCounter.inc()
    throw new Error(ERROR_NO_STAMP)
  }

  /**
   * Refresh stamps from the bee node and if needed buy new stamp
   *
   * @param config Stamps config
   * @param beeDebug Connection to debug endpoint for checking/buying stamps
   */
  public async refreshStampsAutobuy(): Promise<void> {
    try {
      stampCheckCounter.inc()
      logger.info('checking postage stamps')
      const stamps = await beeDebug.getAllPostageBatch()
      logger.debug('retrieved stamps', stamps)

      const { depth, amount } = requireAutobuyConfig()

      // Get all usable stamps sorted by usage from most used to least
      this.usableStamps = filterUsableStampsAutobuy(stamps, depth, amount, config.usageMax, config.ttlMin)
      const leastUsed = this.usableStamps[this.usableStamps.length - 1]
      const mostUsed = this.usableStamps[0]

      stampTtlGauge.set(mostUsed ? mostUsed.batchTTL : 0)
      stampUsageGauge.set(mostUsed ? getUsage(mostUsed) : 0)
      stampUsableCountGauge.set(this.usableStamps.length)

      // Check if the least used stamps is starting to get full and if so purchase new stamp
      if (!leastUsed || getUsage(leastUsed) >= config.usageThreshold) {
        try {
          const { stamp } = await buyNewStamp(depth, amount)

          // Add the bought postage stamp
          this.usableStamps.push(stamp)
          stampUsableCountGauge.set(this.usableStamps.length)
        } catch (e) {
          logger.error('failed to buy postage stamp', e)
          stampPurchaseFailedCounter.inc()
        }
      }
    } catch (e) {
      logger.error('failed to refresh postage stamp', e)
    }
  }

  public async refreshStampsExtends(): Promise<void> {
    stampCheckCounter.inc()
    logger.info('checking postage stamps')

    const { depth, amount } = requireAutobuyConfig()

    try {
      const stamps = await beeDebug.getAllPostageBatch()
      logger.debug('retrieved stamps', stamps)

      // Get all usable stamps sorted by usage from most used to least
      this.usableStamps = filterUsableStampsExtends(stamps)

      if (!this.usableStamps.length) {
        const { stamp: newStamp } = await buyNewStamp(depth, amount)

        // Add the bought postage stamp
        this.usableStamps.push(newStamp)
      } else {
        await this.topUpStamps(config.ttlMin, amount)
      }
    } catch (e) {
      logger.error('failed to refresh on extends postage stamps', e)
    }
  }

  async topUpStamps(ttlMin: number, amount: string) {
    for (const stamp of this.usableStamps) {
      const minTimeThreshold = ttlMin + config.refreshPeriod / 1000

      if (stamp.batchTTL < minTimeThreshold) {
        logger.info(`extending postage stamp ${stamp.batchID}`)

        try {
          await topUpStamp(stamp.batchID, amount)
        } catch (e) {
          logger.error('failed to topup postage stamp', e)
        }
      }
    }
  }
}
