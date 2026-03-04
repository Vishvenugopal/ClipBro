const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('selectionAPI', {
  sendSelection: (rect) => ipcRenderer.send('selection-complete', rect),
  cancel: () => ipcRenderer.send('selection-cancel')
});
