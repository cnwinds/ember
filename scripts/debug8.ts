import { Sim } from '../src/sim/game';
import { BIRD_R } from '../src/core/constants';

// 攒速曲线：从静止持续按住，打印每秒速度（爆燃后热度清零继续，观察节奏）
const s = new Sim(777);
s.x = 2000;
const th = s.terrain.tangentAngle(s.x);
s.y = s.terrain.heightAt(s.x) - BIRD_R * Math.cos(th);
s.vx = 300 * Math.cos(th);
s.vy = 300 * Math.sin(th);
s.grounded = true;
let blew = 0;
for (let i = 0; i < 120 * 25; i++) {
  s.step(true);
  s.drainEvents().forEach(e => { if (e.type === 'blowout') blew++; });
  if (i % 120 === 0) {
    console.log(`t=${(i/120)}s 速度=${s.speed|0} 热度=${s.heatSys.heat.toFixed(0)} 爆燃次数=${blew}`);
  }
}
// 满速惯性：松手后速度衰减
let v0 = s.speed;
for (let i = 0; i < 120 * 3; i++) { s.step(false); s.drainEvents(); }
console.log(`惯性: 松手时 ${v0|0} → 3s后 ${s.speed|0}（保留 ${((s.speed/v0)*100)|0}%）`);
