import { Bee, BeeDebug } from '@ethersphere/bee-js'
import { config } from './config'

export const bee = new Bee(config.beeApiUrl)
export const beeDebug = new BeeDebug(config.beeDebugApiUrl)
