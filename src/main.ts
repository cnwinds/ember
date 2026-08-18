/**
 * 熔岩尾焰鸟 Ember —— 入口。
 * Vite + TS + Canvas2D，零运行时依赖；npm run dev 即玩，build 断网可玩。
 */

import './style.css';
import { App } from './app';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const app = new App(canvas);
app.start();

// 暴露给调试台（?debug 模式配合使用）
declare global {
  interface Window {
    __ember?: App;
  }
}
window.__ember = app;
