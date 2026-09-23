import { join } from 'node:path'

import { BrowserWindow, app, shell } from 'electron'

import { registerIpc, wireCloseBehavior } from './ipc'

function showWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
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
    },
  })

  win.on('ready-to-show', () => win.show())

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
