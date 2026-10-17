/** Русский: исходный словарь. Ключи отсюда обязаны быть во всех остальных языках (это проверяет TypeScript). */
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

const ru = {
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

export default ru
export type I18nKey = keyof typeof ru
export type Dict = Record<I18nKey, string>
