// Reusable projectile firing helper
// Options:
// - spreadDeg: total spread in degrees (e.g., 70)
// - count: number of projectiles
// - radius: circle hitbox radius (pixels)
// - speed: velocity magnitude
// - lifeMs: lifetime in ms
// - damage: damage per hit
// - staggerTime: stun duration in ms on hit (0 = no stun)
// - ricochet: boolean enable wall ricochet
// - bounceCount: number of bounces if ricochet true (default 1)
// - skillKey: 'Z' | 'X' | 'C' (for skillId prefix)
// - baseAngleRad: override base angle in radians (default owner._facingAngleRad())
// - startOffset: distance from owner center to spawn

function ensureTriangleTexture(scene, sizeW, sizeH, color = 0xff0000) {
  const key = `proj_tri_${sizeW}x${sizeH}_${color}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(color, 1);
  g.beginPath();
  // 삼각형(기본: 오른쪽(+X) 방향을 향함)
  g.moveTo(sizeW, sizeH / 2); // 오른쪽 끝(첨단)
  g.lineTo(0, 0); // 좌상단
  g.lineTo(0, sizeH); // 좌하단
  g.closePath();
  g.fillPath();
  g.generateTexture(key, sizeW, sizeH);
  g.destroy();
  return key;
}

export function fireProjectiles(owner, options = {}) {
  const scene = owner.scene;
  if (!owner.projectileGroup) {
    owner.projectileGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });
  }

  const spreadDeg = options.spreadDeg ?? 0;
  const count = Math.max(1, options.count ?? 1);
  const speed = options.speed ?? 500;
  const radius = Math.max(1, options.radius ?? 6);
  const lifeMs = Math.max(0, options.lifeMs ?? 1000);
  const damage = options.damage ?? 1;
  const staggerTime = Math.max(0, options.staggerTime ?? 0);
  const ricochet = !!options.ricochet;
  const bounceCount = Math.max(0, options.bounceCount ?? 1);
  const skillKey = options.skillKey ?? "C";
  const base =
    typeof options.baseAngleRad === "number"
      ? options.baseAngleRad
      : owner._facingAngleRad
      ? owner._facingAngleRad()
      : 0;
  const startOffset =
    options.startOffset ?? Math.max(owner.width, owner.height) * 0.4;

  const stepRad = count > 1 ? Phaser.Math.DegToRad(spreadDeg) / (count - 1) : 0;
  const startAngle = base - Phaser.Math.DegToRad(spreadDeg) / 2;

  // 비주얼 텍스처 결정(기본: 빨간 삼각형)
  const color = options.color ?? 0xff0000;
  const spriteKey =
    options.spriteKey ??
    ensureTriangleTexture(
      scene,
      Math.max(8, radius * 2),
      Math.max(6, Math.floor(radius * 1.2)),
      color
    );
  const projs = [];
  for (let i = 0; i < count; i++) {
    const ang = startAngle + stepRad * i;
    const px = owner.x + Math.cos(ang) * startOffset;
    const py = owner.y + Math.sin(ang) * startOffset;

    const proj = owner.projectileGroup.create(px, py, spriteKey);
    proj.setOrigin(0.5, 0.5);
    proj.setVisible(true);
    proj.owner = owner;
    proj.damage = damage;
    proj.skillId = owner.getAttackSegmentId
      ? owner.getAttackSegmentId(skillKey, i)
      : `${skillKey}-${Date.now()}-${i}`;
    proj.staggerTime = staggerTime;
    proj.ricochet = ricochet;
    proj.bouncesLeft = ricochet ? bounceCount : 0;
    proj.body.setAllowGravity(false);
    proj.body.setImmovable(true);
    proj.body.setCircle(radius, 0, 0);

    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    proj.body.setVelocity(vx, vy);
    // 시각적으로 진행 방향을 향하도록 회전
    proj.setRotation(ang);

    scene.time.delayedCall(lifeMs, () => {
      if (proj && proj.active) proj.destroy();
    });
    projs.push(proj);
  }

  return projs;
}
