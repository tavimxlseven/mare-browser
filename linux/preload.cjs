"use strict";
const {contextBridge,ipcRenderer}=require("electron");
// Only this local chrome document has a preload. Remote pages get no Node or IPC bridge.
contextBridge.exposeInMainWorld("ipc",Object.freeze({postMessage(value){
  if(typeof value==="string" && value.length<=262144) ipcRenderer.send("compass-command",value);
}}));
