import { System } from 'cafe-utility'
import client from 'prom-client'
import { bee } from './bee'
import { config } from './config'
import { logger } from './logger'
import { register } from './metrics'

const contentReuploadCounter = new client.Counter({
  name: 'content_reupload_counter',
  help: 'How many pinned content items were uploaded',
})
register.registerMetric(contentReuploadCounter)

export class ContentManager {
  start(): void {
    System.forever(this.attemptRefreshContentReupload.bind(this), config.refreshPeriod)
  }

  private async attemptRefreshContentReupload(): Promise<void> {
    try {
      await this.refreshContentReupload()
    } catch (error) {
      logger.error('content reupload job failed', error)
    }
  }

  private async refreshContentReupload(): Promise<void> {
    const pins = await bee.getAllPins()

    for (const pin of pins) {
      logger.info(`checking if ${pin} is retrievable`)
      const isRetrievable = await bee.isReferenceRetrievable(pin)
      logger.debug(`pin ${pin} is ${isRetrievable ? 'retrievable' : 'not retrievable'}`)

      if (!isRetrievable) {
        try {
          logger.debug(`reuploading pinned content: ${pin}`)
          await bee.reuploadPinnedData(pin)
          contentReuploadCounter.inc()
          logger.info(`pinned content reuploaded: ${pin}`)
        } catch (error) {
          logger.error('failed to reupload pinned content', error)
        }
      }
    }
  }
}
