// 간단 디버프 유틸: 슬로우/스턴, 우선순위 라벨 표시

const PRIORITY = {
  stun: 2,
  slow: 1,
};

function _ensureDebuffState(target) {
  if (!target._debuffs) target._debuffs = [];
}

function _updateSpeedMultiplier(target) {
  // 가장 강한 슬로우만 적용(가장 낮은 multiplier)
  let mult = 1;
  const now = target.scene?.time?.now ?? performance.now();
  for (const d of target._debuffs || []) {
    if (d.type === "slow" && d.expiresAt > now) {
      mult = Math.min(mult, d.multiplier);
    }
  }
  target.speedMultiplier = mult;
}

function _updateDebuffLabel(target) {
  const now = target.scene?.time?.now ?? performance.now();
  let top = null;
  for (const d of target._debuffs || []) {
    if (d.expiresAt <= now) continue;
    if (!top || d.priority > top.priority) top = d;
  }
  if (!top) {
    if (target.debuffLabel) target.debuffLabel.setVisible(false);
    return;
  }
  const scene = target.scene;
  if (!target.debuffLabel) {
    target.debuffLabel = scene.add
      .text(target.x, target.y - (target.height || 16) - 8, "", {
        fontSize: "12px",
        fill: "#ffd166",
        stroke: "#000000",
        strokeThickness: 3,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      })
      .setOrigin(0.5, 1)
      .setDepth(25);
  }
  target.debuffLabel.setText(top.label || top.type.toUpperCase());
  target.debuffLabel.setVisible(true);
  // 위치 갱신은 GameScene나 Player update에서 함께 움직이므로 여기선 즉시 위치만 맞춤
  target.debuffLabel.setPosition(
    target.x,
    target.y - (target.height || 16) - 8
  );
}

function _scheduleCleanup(scene, target) {
  // 주기적으로 만료 정리 및 라벨/속도 갱신
  if (target._debuffCleanupScheduled) return;
  target._debuffCleanupScheduled = true;
  scene.time.addEvent({
    delay: 150,
    loop: true,
    callback: () => {
      const now = scene.time.now;
      if (!target._debuffs || target._debuffs.length === 0) {
        target._debuffCleanupScheduled = false;
        _updateSpeedMultiplier(target);
        _updateDebuffLabel(target);
        return;
      }
      let changed = false;
      target._debuffs = target._debuffs.filter((d) => {
        const alive = d.expiresAt > now;
        if (!alive) changed = true;
        return alive;
      });
      if (changed) {
        _updateSpeedMultiplier(target);
        _updateDebuffLabel(target);
      }
      // 루프는 target이 씬에서 제거되면 GC될 것이며, 간단화를 위해 별도의 off는 생략
    },
  });
}

export function applySlow(
  scene,
  target,
  {
    percent = 0.3,
    durationMs = 500,
    priority = PRIORITY.slow,
    label = "감속",
  } = {}
) {
  _ensureDebuffState(target);
  const now = scene.time.now;
  const d = {
    type: "slow",
    priority,
    label,
    expiresAt: now + durationMs,
    multiplier: Math.max(0, 1 - Math.max(0, Math.min(1, percent))),
  };
  target._debuffs.push(d);
  _updateSpeedMultiplier(target);
  _updateDebuffLabel(target);
  _scheduleCleanup(scene, target);
}

export function applyStun(
  scene,
  target,
  { durationMs = 700, priority = PRIORITY.stun, label = "기절" } = {}
) {
  _ensureDebuffState(target);
  // Player의 기존 경직 로직 활용
  if (typeof target.applyStagger === "function") {
    target.applyStagger(durationMs);
  }
  const now = scene.time.now;
  const d = { type: "stun", priority, label, expiresAt: now + durationMs };
  target._debuffs.push(d);
  _updateDebuffLabel(target);
  _scheduleCleanup(scene, target);
}

export function clearDebuffs(target) {
  target._debuffs = [];
  target.speedMultiplier = 1;
  if (target.debuffLabel) target.debuffLabel.setVisible(false);
}

export { PRIORITY };
