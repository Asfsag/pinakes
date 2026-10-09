const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = n => (...a) => ipcRenderer.invoke(n, ...a);
contextBridge.exposeInMainWorld('pin', {
  getRoot: call('getRoot'), chooseRoot: call('chooseRoot'), listBooks: call('listBooks'), findByHash: call('findByHash'), pickBooks: call('pickBooks'),
  readFile: call('readFile'), createBook: call('createBook'), addFormat: call('addFormat'), readFormat: call('readFormat'),
  updateBook: call('updateBook'), removeBook: call('removeBook'), exportBook: call('exportBook'), mergeBooks: call('mergeBooks'), onShelf: fn => ipcRenderer.on('shelf-changed', () => fn()), exportAll: call('exportAll'), reveal: call('reveal'), revealRoot: call('revealRoot'),
  pathForFile: f => webUtils.getPathForFile(f),
});
