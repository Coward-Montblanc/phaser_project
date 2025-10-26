// Beam (laser) helper: straight line in angle until wall or maxLength
// Options:
// - thickness: visual and hitbox thickness (px), default 8
// - durationMs: life time in ms, default 300
// - color: rectangle color, default 0xffffff
// - wallPierce: if true, ignore walls and use maxLength
// - maxLength: used when wallPierce true, default 300
// - damage: damage per target (once per beam), default 1
// - staggerTime: stun duration in ms on hit (0 = no stun)
// - skillKey: 'C' etc., for skillId prefix

function _rayLengthFrom(owner, wallLayer, angleRad, maxIfNoWall = 300) {
  const scene = owner.scene;
  const step = 4; // world px step
  const tilemap = wallLayer?.tilemap;
  const maxW = tilemap?.widthInPixels ?? scene.scale.width;
  const maxH = tilemap?.heightInPixels ?? scene.scale.height;
  let len = 0;
  let x = owner.x;
  let y = owner.y;
  while (len < 2000 && x >= 0 && y >= 0 && x < maxW && y < maxH) {
    const tx = wallLayer.worldToTileX(x);
    const ty = wallLayer.worldToTileY(y);
    if (wallLayer.hasTileAt(tx, ty)) break;
    len += step;
    x += Math.cos(angleRad) * step;
    y += Math.sin(angleRad) * step;
    if (len >= maxIfNoWall) break;
  }
  return len;
}

export function fireBeam(owner, options = {}) {
  const scene = owner.scene;
  if (!owner.beamGroup) {
    owner.beamGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });
  }

  const thickness = Math.max(1, options.thickness ?? 8);
  const durationMs = Math.max(1, options.durationMs ?? 300);
  const color = options.color ?? 0xffffff;
  const wallPierce = !!options.wallPierce;
  const maxLength = Math.max(1, options.maxLength ?? 300);
  const damage = options.damage ?? 1;
  const staggerTime = Math.max(0, options.staggerTime ?? 0);
  const skillKey = options.skillKey ?? "C";
  const angle =
    typeof options.baseAngleRad === "number"
      ? options.baseAngleRad
      : owner._mouseAngleRad
      ? owner._mouseAngleRad()
      : 0;

  // Compute length
  const length = wallPierce
    ? maxLength
    : _rayLengthFrom(owner, owner.wallLayer, angle, maxLength);

  // Visual beam: rectangle centered along segment
  const midX = owner.x + Math.cos(angle) * (length / 2);
  const midY = owner.y + Math.sin(angle) * (length / 2);
  const rect = scene.add
    .rectangle(midX, midY, length, thickness, color, 1)
    .setDepth(9);
  rect.setRotation(angle);

  // Hitboxes along the beam (circle samples)
  const sampleStep = Math.max(6, Math.floor(thickness * 0.8));
  const radius = Math.max(4, Math.floor(thickness / 2));
  const count = Math.max(1, Math.floor(length / sampleStep));
  const hitIds = []; // created bodies
  for (let i = 0; i <= count; i++) {
    const t = count === 0 ? 0.5 : i / count;
    const px = owner.x + Math.cos(angle) * (t * length);
    const py = owner.y + Math.sin(angle) * (t * length);
    const texKey = owner._ensureHitTexture
      ? owner._ensureHitTexture(scene, radius)
      : undefined;
    const hb = owner.beamGroup.create(px, py, texKey);
    hb.setVisible(false);
    hb.owner = owner;
    hb.damage = damage;
    hb.skillId = owner.getAttackSegmentId
      ? owner.getAttackSegmentId(skillKey, 0)
      : `${skillKey}-${Date.now()}-beam`;
    hb.staggerTime = staggerTime;
    hb.body.setAllowGravity(false);
    hb.body.setImmovable(true);
    hb.body.setCircle(radius, 0, 0);
    hitIds.push(hb);
  }

  scene.time.delayedCall(durationMs, () => {
    rect.destroy();
    for (const hb of hitIds) {
      if (hb && hb.active) hb.destroy();
    }
  });
}
