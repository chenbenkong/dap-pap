// ============================================================
// 全局类型扩展
// 本教具在 window 上挂载了若干调试/协作用钩子
// （__MLAB_BOOTED / __MLAB_READY / __mLabFail / __focusPart / __hlTO 等），
// 这里统一放宽类型，避免大量无意义的断言。
// ============================================================
declare global {
  interface Window {
    [key: string]: any;
  }
}

export {};
