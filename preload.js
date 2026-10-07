const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // IGDB & Detalles
  discoverGames: (opts) => ipcRenderer.invoke('igdb:discover', opts),
  getGenres: () => ipcRenderer.invoke('igdb:genres'),
  getGameDetails: (id) => ipcRenderer.invoke('igdb:getDetails', id),
  // Id de IGDB con el que se puntúa un juego (lo busca si es importado)
  ratingId: (id) => ipcRenderer.invoke('games:ratingId', id),

  // Steam Requisitos Reales
  getRealRequirements: (ids) => ipcRenderer.invoke('steam:getRequirements', ids),

  // Biblioteca local y Gestión
  getGames: () => ipcRenderer.invoke('games:get'),
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  setExecutable: (id, data) => ipcRenderer.invoke('games:setExe', { id, ...data }),
  unlinkExecutable: (id) => ipcRenderer.invoke('games:unlink', id),
  launchGame: (id) => ipcRenderer.invoke('games:launch', id),
  
  // Estados de juego
  markCompleted: (id) => ipcRenderer.invoke('games:completed', id),
  returnToLibrary: (id) => ipcRenderer.invoke('games:return', id),
  removeGame: (id) => ipcRenderer.invoke('games:remove', id),
  togglePlatinum: (id) => ipcRenderer.invoke('games:togglePlatinum', id),
  updateSortKey: (id, sortKey) => ipcRenderer.invoke('games:updateSortKey', { id, sortKey }),

  // Importar + carátulas
  importInstalledGames: (config) => ipcRenderer.invoke('games:importInstalled', config),
  enrichCovers: (opts) => ipcRenderer.invoke('games:enrichCovers', opts),

  // Diálogos del Sistema
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectoryDialog: (opts) => ipcRenderer.invoke('dialog:openDirectory', opts),

  // Specs del equipo, para comparar contra los requisitos del juego
  getSystemSpecs: () => ipcRenderer.invoke('system:getSpecs'),

  // Historial de versiones
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getChangelog: () => ipcRenderer.invoke('changelog:get'),

  // Actualizaciones automáticas
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (_e, state) => cb(state)),

  // Ajustes de usuario
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // Sagas / carpetas de juegos
  getSagas: () => ipcRenderer.invoke('sagas:get'),
  createSaga: (name) => ipcRenderer.invoke('sagas:create', name),
  deleteSaga: (id) => ipcRenderer.invoke('sagas:delete', id),
  addGameToSaga: (sagaId, gameId) => ipcRenderer.invoke('sagas:addGame', { sagaId, gameId }),
  removeGameFromSaga: (sagaId, gameId) => ipcRenderer.invoke('sagas:removeGame', { sagaId, gameId }),
  moveGameInSaga: (sagaId, gameId, direction) => ipcRenderer.invoke('sagas:moveGame', { sagaId, gameId, direction }),
  renameSaga: (sagaId, name) => ipcRenderer.invoke('sagas:rename', { sagaId, name }),
  reorderSagas: (ids) => ipcRenderer.invoke('sagas:reorder', ids),
  setSagaOrder: (sagaId, gameIds) => ipcRenderer.invoke('sagas:setOrder', { sagaId, gameIds }),
  sortSagaByRelease: (sagaId) => ipcRenderer.invoke('sagas:sortByRelease', sagaId),
  getSagaSuggestions: () => ipcRenderer.invoke('sagas:suggestions'),
  dismissSagaSuggestion: (name) => ipcRenderer.invoke('sagas:dismissSuggestion', name),

  // Lanzamiento: pasos para el modal de "Abriendo..."
  onLaunchProgress: (cb) => ipcRenderer.on('launch:progress', (_e, p) => cb(p)),

  // PokéPark
  pokeparkDex: () => ipcRenderer.invoke('pokepark:dex'),
  pokeparkGet: () => ipcRenderer.invoke('pokepark:get'),
  pokeparkSave: (state) => ipcRenderer.invoke('pokepark:save', state),
  pokeparkSprite: (url) => ipcRenderer.invoke('pokepark:sprite', url),
  // Minijuegos (minigames.js en main)
  minigames: (action, ...args) => ipcRenderer.invoke('minigames:' + action, ...args),
  // Guardar el parque ya (al cobrar una apuesta no se espera al guardado normal)
  pokeparkSaveNow: (state) => ipcRenderer.invoke('pokepark:save', state),

  // Borrar todos los datos
  clearAllData: () => ipcRenderer.invoke('data:clearAll'),

  // Copias de partidas
  scanSaves: () => ipcRenderer.invoke('saves:scan'),
  chooseBackupDir: (current) => ipcRenderer.invoke('saves:chooseDir', current),
  backupSaves: (ids, dir) => ipcRenderer.invoke('saves:backup', { ids, dir }),
  openBackupDir: (dir) => ipcRenderer.invoke('saves:openDir', dir),
  onBackupProgress: (cb) => ipcRenderer.on('saves:progress', (_e, p) => cb(p)),

  // IA (Claude)
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  aiClearKey: () => ipcRenderer.invoke('ai:clearKey'),
  aiOrderSaga: (sagaId) => ipcRenderer.invoke('ai:orderSaga', sagaId),
  aiRecommend: (opts) => ipcRenderer.invoke('ai:recommend', opts),

  // Cuenta, nube y comunidad (cloud.js en main)
  cloud: (action, ...args) => ipcRenderer.invoke('cloud:' + action, ...args),
  onCloudStatus: (cb) => ipcRenderer.on('cloud:status', (_e, s) => cb(s)),
  onCloudData: (cb) => ipcRenderer.on('cloud:dataChanged', (_e, d) => cb(d)),
  onCloudProfile: (cb) => ipcRenderer.on('cloud:profile', () => cb()),
  getStats: () => ipcRenderer.invoke('stats:get'),
  saveStats: (stats) => ipcRenderer.invoke('stats:save', stats),

  // Spotify (spotify.js en main)
  spotify: (action, ...args) => ipcRenderer.invoke('spotify:' + action, ...args),

  // Cuentas de Steam/Epic/GOG (stores.js en main) y descargas
  stores: (action, ...args) => ipcRenderer.invoke('stores:' + action, ...args),
  onStoresProgress: (cb) => ipcRenderer.on('stores:progress', (_e, p) => cb(p)),
  onGamesChanged: (cb) => ipcRenderer.on('games:changed', () => cb()),

  // Tiempo jugado, duración (HowLongToBeat), juegos gratis y atajos
  playtimeRunning: () => ipcRenderer.invoke('playtime:running'),
  onPlaytime: (cb) => ipcRenderer.on('playtime:changed', (_e, d) => cb(d)),
  hltb: (q) => ipcRenderer.invoke('games:hltb', q),
  freeGames: (force) => ipcRenderer.invoke('free:get', force),
  freeRefresh: () => ipcRenderer.invoke('free:refresh'),
  onFreeGames: (cb) => ipcRenderer.on('free:changed', (_e, d) => cb(d)),
  onFreeNew: (cb) => ipcRenderer.on('free:new', (_e, d) => cb(d)),
  setGlobalShortcuts: (list) => ipcRenderer.invoke('shortcuts:global', list),
  onShortcut: (cb) => ipcRenderer.on('shortcuts:run', (_e, action) => cb(action)),

  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
});
