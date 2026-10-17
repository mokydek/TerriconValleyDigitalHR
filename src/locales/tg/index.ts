import type { Dict } from '../ru'
import core from './core'
import dates from './dates'
import consts from './consts'
import login from './login'
import chat from './chat'
import home from './home'
import analytics from './analytics'
import requests from './requests'
import academy from './academy'
import tasks from './tasks'
import profile from './profile'
import assistant from './assistant'
import jana from './jana'
import server from './server'

const tg: Dict = {
  ...core,
  ...dates,
  ...consts,
  ...login,
  ...chat,
  ...home,
  ...analytics,
  ...requests,
  ...academy,
  ...tasks,
  ...profile,
  ...assistant,
  ...jana,
  ...server,
}

export default tg
