const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // IGDB & Detalles
  discoverGames: (opts) => ipcRenderer.invoke('igdb:discover', opts),
  getGenres: () => ipcRenderer.invoke('igdb:genres'),
  getGameDetails: (id) => ipcRenderer.invoke('igdb:getDetails', id),

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

  // Música (Spotify vía controles multimedia de Windows) y letras
  mediaStart: () => ipcRenderer.invoke('media:start'),
  mediaStop: () => ipcRenderer.invoke('media:stop'),
  mediaCommand: (cmd) => ipcRenderer.invoke('media:command', cmd),
  mediaLyrics: (track) => ipcRenderer.invoke('media:lyrics', track),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  mediaOpenSpotify: () => ipcRenderer.invoke('media:openSpotify'),
  onMediaState: (cb) => ipcRenderer.on('media:state', (_e, s) => cb(s)),
});
