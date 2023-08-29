import express, { Application } from 'express'
import { Options, createProxyMiddleware } from 'http-proxy-middleware'
import { bee } from './bee'
import * as bzzLink from './bzz-link'
import { config } from './config'
import { logger } from './logger'
import { register } from './metrics'
import { ReadinessStatus, checkReadiness } from './readiness'
import type { StampsManager } from './stamps'

const SWARM_STAMP_HEADER = 'swarm-postage-batch-id'

export const GET_PROXY_ENDPOINTS = [
  '/bzz/:reference',
  '/bzz/:reference/*',
  '/bytes/:reference',
  '/chunks/:reference',
  '/feeds/:owner/:topic',
]
export const POST_PROXY_ENDPOINTS = ['/bzz', '/bytes', '/chunks', '/feeds/:owner/:topic', '/soc/:owner/:id']

export const createApp = (stampManager?: StampsManager): Application => {
  const commonOptions: Options = {
    target: bee.url,
    changeOrigin: true,
    logProvider: () => logger,
  }

  const app = express()

  const subdomainOffset = config.hostname.split('.').length
  app.set('subdomain offset', subdomainOffset)

  if (config.authorization) {
    app.use('', (req, res, next) => {
      if (req.headers.authorization === config.authorization) {
        next()
      } else {
        res.sendStatus(403)
      }
    })
  }

  if (config.cidSubdomains || config.ensSubdomains) {
    if (config.hostname === 'localhost') {
      logger.warn(`bzz.link support is enabled but HOSTNAME is set to the default localhost`)
    }

    if (config.cidSubdomains) {
      logger.info(`enabling CID subdomain support with hostname ${config.hostname}`)
    }

    if (config.ensSubdomains) {
      logger.info(`enabling ENS subdomain support with hostname ${config.hostname}`)
    }

    app.get(
      '*',
      createProxyMiddleware(bzzLink.requestFilter, {
        ...commonOptions,
        cookieDomainRewrite: config.hostname,
        router: bzzLink.routerClosure(bee.url, Boolean(config.cidSubdomains), Boolean(config.ensSubdomains)),
      }),
    )

    app.use(bzzLink.errorHandler)
  } else {
    logger.info('starting the app without bzz.link support (see HOSTNAME, ENS_SUBDOMAINS and CID_SUBDOMAINS)')
  }

  app.get('/metrics', async (_req, res) => {
    res.send(await register.metrics())
  })

  // Health endpoint
  app.get('/health', (_req, res) => res.send('OK'))

  // Readiness endpoint
  app.get('/readiness', async (_req, res) => {
    const readinessStatus = await checkReadiness(stampManager)

    if (readinessStatus === ReadinessStatus.OK) {
      res.end('OK')
    } else if (readinessStatus === ReadinessStatus.NO_STAMP) {
      res.status(503).end(readinessStatus)
    } else {
      res.status(502).end(readinessStatus)
    }
  })

  // Download file/collection/chunk proxy
  app.get(GET_PROXY_ENDPOINTS, createProxyMiddleware(commonOptions))

  const options: Options = { ...commonOptions }

  options.onProxyReq = (proxyReq, _req, res) => {
    if (config.removePinHeader) {
      proxyReq.removeHeader('swarm-pin')
    }

    if (stampManager) {
      proxyReq.removeHeader(SWARM_STAMP_HEADER)
      try {
        proxyReq.setHeader(SWARM_STAMP_HEADER, stampManager.postageStamp)
      } catch (error: any) {
        logger.error('proxy failure', error)
        res.writeHead(503).end(error.message)
      }
    }
  }

  // Upload file/collection proxy
  app.post(POST_PROXY_ENDPOINTS, createProxyMiddleware(options))

  app.use(express.static('public'))
  app.use((_req, res) => res.sendStatus(404))

  return app
}
