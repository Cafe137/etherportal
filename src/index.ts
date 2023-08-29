#!/usr/bin/env node
import { Application } from 'express'

import { config } from './config'
import { ContentManager } from './content'
import { logger, subscribeLogServerRequests } from './logger'
import { createApp } from './server'
import { StampsManager } from './stamps'

async function main() {
  logger.info('config', config)

  let app: Application

  if (config.reupload) {
    logger.info('starting content manager')
    new ContentManager().start()
  }

  if (config.mode) {
    logger.info('starting postage stamp manager')
    logger.info('starting the proxy')
    app = createApp(new StampsManager().start())
  } else {
    logger.info('starting the app without postage stamp management')
    app = createApp()
  }

  // Start the Proxy
  const server = app.listen(config.port, () => {
    logger.info(`starting gateway-proxy at ${config.hostname}:${config.port}`)
  })

  subscribeLogServerRequests(server)
}

main()
