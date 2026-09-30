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
});
