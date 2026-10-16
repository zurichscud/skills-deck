import { join } from 'node:path'

import { BrowserWindow, app, shell } from 'electron'

import { registerIpc, wireCloseBehavior } from './ipc'

/**
 * E2E 用：窗口创建后不显示，也不占 Dock，测试不会在别人屏幕上弹窗。
 * 隐藏窗口会被 Chromium 当后台页面节流，因此同时关掉 backgroundThrottling。
 */
const HEADLESS = process.env['SKILLSDECK_HEADLESS'] === '1'

function showWindow(win: BrowserWindow): void {
  if (HEADLESS || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    ...(process.platform === 'darwin'
      ? ({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 16 } } as const)
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 隐藏窗口默认被节流，会拖住渲染与动画；测试期间保持全速
      backgroundThrottling: !HEADLESS,
    },
  })

  if (!HEADLESS) win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  wireCloseBehavior(win, () => showWindow(win))
  return win
}

app.whenReady().then(() => {
  if (HEADLESS && process.platform === 'darwin') app.dock?.hide()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing) showWindow(existing)
    else createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
