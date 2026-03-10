(function () {
  const {
    Bodies,
    Body,
    Composite,
  } = Matter;

  const TILE = 32;

  function makeBody(x, y, width, height, extra) {
    return Bodies.rectangle(x, y, width, height, Object.assign({
      isStatic: true,
      friction: 0.8,
      restitution: 0,
      label: "solid",
      render: { visible: false },
    }, extra || {}));
  }

  function makeRng(seed) {
    let value = seed >>> 0;
    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function randRange(rng, min, max) {
    return min + rng() * (max - min);
  }

  function randInt(rng, min, max) {
    return Math.floor(randRange(rng, min, max + 1));
  }

  function snapToTile(value) {
    return Math.round(value / TILE) * TILE;
  }

  function createWorld(engine) {
    const state = {
      tile: TILE,
      level: 1,
      seed: 0,
      bounds: { width: 3200, height: 1400 },
      spawn: { x: 160, y: 320 },
      goal: { x: 0, y: 0, width: 96, height: 160 },
      worldSolids: [],
      floorBodies: [],
      solids: [],
      hazards: [],
      enemies: [],
      projectiles: [],
      meteors: [],
      floorConfig: {
        centerY: 690,
        height: 320,
      },
      skyEvent: {
        cooldown: 390,
        warning: null,
        activeProjectile: null,
        gate: null,
      },
      backdrop: null,
    };

    buildLevel(engine, state, 1);
    return state;
  }

  function updateEnemies(state) {
    state.enemies.forEach((enemy) => {
      if (!enemy.alive) {
        if (enemy.body.collisionFilter.mask !== 0) {
          enemy.body.collisionFilter.mask = 0;
        }
        return;
      }

      const x = enemy.body.position.x;
      if (x >= enemy.right) {
        enemy.direction = -1;
      } else if (x <= enemy.left) {
        enemy.direction = 1;
      }

      Body.setVelocity(enemy.body, {
        x: enemy.direction * enemy.speed,
        y: enemy.body.velocity.y,
      });

      if (enemy.hitFlash > 0) {
        enemy.hitFlash -= 1;
      }
    });
  }

  function clearBodies(engine, state) {
    state.worldSolids.forEach((body) => Composite.remove(engine.world, body));
    state.floorBodies.forEach((body) => Composite.remove(engine.world, body));
    state.hazards.forEach((hazard) => Composite.remove(engine.world, hazard.body));
    state.enemies.forEach((enemy) => Composite.remove(engine.world, enemy.body));
    state.projectiles.forEach((projectile) => Composite.remove(engine.world, projectile.body));
    if (state.skyEvent.activeProjectile) {
      Composite.remove(engine.world, state.skyEvent.activeProjectile.body);
    }
  }

  function buildLevel(engine, state, levelNumber) {
    clearBodies(engine, state);

    const randomSeed = Math.floor(Math.random() * 4294967295);
    const rng = makeRng(randomSeed);
    const solids = [];
    const hazards = [];
    const enemies = [];
    const projectiles = [];
    const levelWidth = 2600 + Math.min(levelNumber * 220, 1800);
    const bounds = { width: levelWidth, height: 1400 };
    state.floorConfig = {
      centerY: 690,
      height: 320,
    };

    let cursorX = 260;
    let currentY = 540;
    let enemyId = 0;
    let previousPlatform = { x: 160, y: 580, width: 180 };
    const platformCount = 11 + Math.min(levelNumber * 2, 10);

    const startPlatform = makeBody(180, 590, 220, 28);
    solids.push(startPlatform);

    for (let i = 0; i < platformCount; i += 1) {
      const gap = randInt(rng, 120, 200);
      const width = snapToTile(randInt(rng, 128, 224));
      cursorX += gap;
      currentY += snapToTile(randInt(rng, -96, 96));
      currentY = Math.max(280, Math.min(570, currentY));

      const platform = makeBody(cursorX, currentY, width, 24);
      solids.push(platform);

      if (gap >= 150 && rng() > 0.4) {
        const hazardWidth = snapToTile(Math.min(gap - 36, randInt(rng, 96, 160)));
        const hazardX = previousPlatform.x + previousPlatform.width / 2 + gap / 2;
        hazards.push(makeHazard(hazardX, 642, hazardWidth, 18));
      }

      if (width >= 160 && i > 1 && rng() > 0.38) {
        enemies.push(makeEnemy(enemyId, cursorX, currentY - 42, width, levelNumber, rng));
        enemyId += 1;
      }

      if (rng() > 0.68) {
        const stepWidth = snapToTile(randInt(rng, 64, 96));
        const stepY = currentY - randInt(rng, 70, 110);
        const stepX = cursorX + randInt(rng, -18, 18);
        solids.push(makeBody(stepX, stepY, stepWidth, 20));
      }

      previousPlatform = { x: cursorX, y: currentY, width };
    }

    const finishX = levelWidth - 190;
    const finishY = Math.max(300, currentY - 40);
    solids.push(makeBody(finishX - 80, finishY + 72, 220, 24));
    hazards.push(makeHazard(levelWidth * 0.45, 642, 128 + randInt(rng, 0, 64), 18));
    hazards.push(makeHazard(levelWidth * 0.7, 642, 128 + randInt(rng, 0, 64), 18));

    const walls = [
      makeBody(-40, 250, 80, 800, { label: "wall" }),
      makeBody(bounds.width + 40, 250, 80, 800, { label: "wall" }),
    ];
    walls.forEach((wall) => solids.push(wall));

    Composite.add(engine.world, [
      ...solids,
      ...hazards.map((hazard) => hazard.body),
      ...enemies.map((enemy) => enemy.body),
    ]);

    state.level = levelNumber;
    state.seed = randomSeed;
    state.backdrop = pickBackdrop(randomSeed);
    state.bounds = bounds;
    state.spawn = {
      x: startPlatform.position.x - 24,
      y: startPlatform.position.y - 12,
    };
    state.goal = {
      x: finishX,
      y: finishY - 38,
      width: 88,
      height: 148,
    };
    state.worldSolids = solids;
    state.hazards = hazards;
    state.enemies = enemies;
    state.projectiles = projectiles;
    state.skyEvent = {
      cooldown: 390,
      warning: null,
      activeProjectile: null,
      gate: null,
    };
    setFloorGap(engine, state, null);
  }

  function pickBackdrop(seed) {
    const themes = [
      {
        skyTop: "#24124a",
        skyMid: "#15193a",
        skyLow: "#0d1328",
        skyBottom: "#060913",
        moonOuter: "rgba(157, 116, 255, 0.18)",
        moonInner: "rgba(111, 231, 255, 0.22)",
        farColor: "#0d1430",
        farGlow: "rgba(80, 120, 255, 0.15)",
        farWindow: "#223d7d",
        nearColor: "#111b3b",
        nearGlow: "rgba(70, 220, 255, 0.16)",
        nearWindow: "#49d6ff",
        fogTop: "rgba(50, 80, 170, 0)",
        fogMid: "rgba(40, 55, 120, 0.08)",
        fogBottom: "rgba(10, 12, 22, 0.28)",
        road: "rgba(18, 26, 50, 0.9)",
        roadLight: "rgba(82, 130, 255, 0.3)",
        roadPillar: "rgba(16, 24, 44, 0.8)",
      },
      {
        skyTop: "#3d2410",
        skyMid: "#322017",
        skyLow: "#1d1420",
        skyBottom: "#090812",
        moonOuter: "rgba(255, 143, 86, 0.18)",
        moonInner: "rgba(255, 211, 123, 0.2)",
        farColor: "#241629",
        farGlow: "rgba(255, 139, 86, 0.12)",
        farWindow: "#8d4c2f",
        nearColor: "#311a2f",
        nearGlow: "rgba(255, 190, 110, 0.18)",
        nearWindow: "#ffb86b",
        fogTop: "rgba(130, 80, 40, 0)",
        fogMid: "rgba(120, 70, 45, 0.08)",
        fogBottom: "rgba(18, 12, 14, 0.3)",
        road: "rgba(34, 24, 26, 0.9)",
        roadLight: "rgba(255, 178, 94, 0.28)",
        roadPillar: "rgba(26, 19, 20, 0.82)",
      },
      {
        skyTop: "#0e3a41",
        skyMid: "#132d38",
        skyLow: "#0d1d2b",
        skyBottom: "#071017",
        moonOuter: "rgba(77, 255, 231, 0.15)",
        moonInner: "rgba(150, 255, 236, 0.22)",
        farColor: "#0d2130",
        farGlow: "rgba(46, 255, 209, 0.15)",
        farWindow: "#1e6b6e",
        nearColor: "#10313d",
        nearGlow: "rgba(79, 255, 228, 0.18)",
        nearWindow: "#63f7e5",
        fogTop: "rgba(40, 120, 120, 0)",
        fogMid: "rgba(20, 108, 108, 0.08)",
        fogBottom: "rgba(6, 18, 20, 0.28)",
        road: "rgba(12, 30, 36, 0.9)",
        roadLight: "rgba(92, 255, 223, 0.25)",
        roadPillar: "rgba(10, 22, 28, 0.82)",
      },
      {
        skyTop: "#36112f",
        skyMid: "#241535",
        skyLow: "#15102a",
        skyBottom: "#090712",
        moonOuter: "rgba(255, 91, 187, 0.17)",
        moonInner: "rgba(177, 111, 255, 0.22)",
        farColor: "#1e1033",
        farGlow: "rgba(255, 96, 191, 0.14)",
        farWindow: "#6d3a9b",
        nearColor: "#25153b",
        nearGlow: "rgba(163, 112, 255, 0.18)",
        nearWindow: "#b483ff",
        fogTop: "rgba(110, 40, 120, 0)",
        fogMid: "rgba(85, 25, 110, 0.08)",
        fogBottom: "rgba(12, 8, 22, 0.3)",
        road: "rgba(20, 15, 35, 0.9)",
        roadLight: "rgba(197, 117, 255, 0.24)",
        roadPillar: "rgba(16, 10, 30, 0.82)",
      },
    ];

    return themes[seed % themes.length];
  }

  function makeHazard(x, y, width, height) {
    const body = makeBody(x, y, width, height, {
      isSensor: true,
      label: "hazard",
    });

    return { body, x, y, width, height };
  }

  function makeEnemy(id, x, y, platformWidth, levelNumber, rng) {
    const body = Bodies.rectangle(x, y, 38, 66, {
      inertia: Infinity,
      friction: 0.02,
      frictionAir: 0.02,
      restitution: 0,
      label: "enemy",
      render: { visible: false },
    });

    Body.setMass(body, 5);
    return {
      id,
      body,
      width: 38,
      height: 66,
      left: x - Math.max(42, platformWidth / 2 - 24),
      right: x + Math.max(42, platformWidth / 2 - 24),
      speed: 1.3 + Math.min(levelNumber * 0.08, 1) + randRange(rng, 0, 0.5),
      direction: rng() > 0.5 ? 1 : -1,
      alive: true,
      hitFlash: 0,
      shootCooldown: randInt(rng, 45, 180),
    };
  }

  function updateCombat(engine, state, player) {
    state.enemies.forEach((enemy) => {
      if (!enemy.alive) {
        return;
      }

      if (enemy.shootCooldown > 0) {
        enemy.shootCooldown -= 1;
        return;
      }

      const dx = player.body.position.x - enemy.body.position.x;
      const dy = player.body.position.y - enemy.body.position.y;
      if (Math.abs(dx) > 520 || Math.abs(dy) > 180) {
        enemy.shootCooldown = 45;
        return;
      }

      const distance = Math.max(1, Math.hypot(dx, dy));
      const direction = dx >= 0 ? 1 : -1;
      enemy.direction = direction;
      spawnProjectile(engine, state, {
        x: enemy.body.position.x + direction * 24,
        y: enemy.body.position.y - 10,
        vx: (dx / distance) * 6.2,
        vy: (dy / distance) * 1.2,
      });
      GameAudio.playEnemyShot();
      enemy.shootCooldown = 180;
    });

    for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = state.projectiles[i];
      projectile.life -= 1;
      Body.setVelocity(projectile.body, {
        x: projectile.vx,
        y: projectile.vy,
      });

      if (
        projectile.life <= 0 ||
        projectile.body.position.x < -100 ||
        projectile.body.position.x > state.bounds.width + 100 ||
        projectile.body.position.y < -100 ||
        projectile.body.position.y > state.bounds.height + 100
      ) {
        removeProjectile(engine, state, projectile.body);
      }
    }
  }

  function updateSkyEvent(engine, state, player) {
    const skyEvent = state.skyEvent;

    if (skyEvent.warning) {
      skyEvent.warning.timer -= 1;
      if (skyEvent.warning.timer <= 0) {
        openFloorForStrike(engine, state, skyEvent.warning.x, skyEvent.warning.width);
        skyEvent.warning = null;
      }
    } else if (!skyEvent.activeProjectile) {
      skyEvent.cooldown -= 1;
      if (skyEvent.cooldown <= 0) {
        scheduleSkyStrike(state, player);
      }
    }

    if (skyEvent.activeProjectile) {
      const projectile = skyEvent.activeProjectile;
      if (
        projectile.body.position.y > state.bounds.height + 120 ||
        projectile.body.position.x < -120 ||
        projectile.body.position.x > state.bounds.width + 120
      ) {
        finishSkyStrike(engine, state);
      }
    }
  }

  function scheduleSkyStrike(state, player) {
    const minX = 320;
    const maxX = state.bounds.width - 320;
    const aroundPlayer = Math.max(minX, Math.min(maxX, player.body.position.x + randRange(Math.random, -180, 180)));
    const x = Math.random() > 0.45 ? aroundPlayer : randRange(Math.random, minX, maxX);
    state.skyEvent.warning = {
      x,
      width: 192,
      timer: 54,
    };
    state.skyEvent.cooldown = 390;
  }

  function openFloorForStrike(engine, state, x, width) {
    setFloorGap(engine, state, { x, width });
    const body = Bodies.circle(x, -120, 22, {
      label: "skyProjectile",
      frictionAir: 0.002,
      restitution: 0,
      density: 0.004,
      render: { visible: false },
    });
    Composite.add(engine.world, body);
    Body.setVelocity(body, { x: 0, y: 6.5 });
    GameAudio.playSkyFall();
    state.skyEvent.activeProjectile = {
      body,
    };
  }

  function finishSkyStrike(engine, state) {
    if (state.skyEvent.activeProjectile) {
      GameAudio.playSkyImpact();
      Composite.remove(engine.world, state.skyEvent.activeProjectile.body);
    }
    state.skyEvent.activeProjectile = null;
    setFloorGap(engine, state, null);
  }

  function setFloorGap(engine, state, gap) {
    state.floorBodies.forEach((body) => Composite.remove(engine.world, body));

    const totalWidth = state.bounds.width;
    const centerY = state.floorConfig.centerY;
    const height = state.floorConfig.height;
    const floorBodies = [];

    if (!gap) {
      floorBodies.push(makeBody(totalWidth / 2, centerY, totalWidth, height, { label: "ground" }));
      state.skyEvent.gate = null;
    } else {
      const safeWidth = Math.max(128, Math.min(gap.width, totalWidth - 320));
      const gapX = Math.max(200 + safeWidth / 2, Math.min(gap.x, totalWidth - 200 - safeWidth / 2));
      const leftWidth = gapX - safeWidth / 2;
      const rightWidth = totalWidth - (gapX + safeWidth / 2);

      if (leftWidth > 0) {
        floorBodies.push(makeBody(leftWidth / 2, centerY, leftWidth, height, { label: "ground" }));
      }
      if (rightWidth > 0) {
        floorBodies.push(makeBody(gapX + safeWidth / 2 + rightWidth / 2, centerY, rightWidth, height, { label: "ground" }));
      }

      state.skyEvent.gate = {
        x: gapX,
        width: safeWidth,
        topY: centerY - height / 2,
      };
    }

    state.floorBodies = floorBodies;
    state.solids = state.worldSolids.concat(floorBodies);
    if (floorBodies.length > 0) {
      Composite.add(engine.world, floorBodies);
    }
  }

  function spawnProjectile(engine, state, projectileData) {
    const body = Bodies.circle(projectileData.x, projectileData.y, 8, {
      label: "projectile",
      isSensor: true,
      frictionAir: 0,
      restitution: 0,
      render: { visible: false },
    });

    const projectile = {
      body,
      vx: projectileData.vx,
      vy: projectileData.vy,
      life: 210,
    };

    state.projectiles.push(projectile);
    Composite.add(engine.world, body);
    Body.setVelocity(body, { x: projectile.vx, y: projectile.vy });
  }

  function removeProjectile(engine, state, projectileBody) {
    const index = state.projectiles.findIndex((projectile) => projectile.body === projectileBody);
    if (index === -1) {
      return;
    }

    Composite.remove(engine.world, state.projectiles[index].body);
    state.projectiles.splice(index, 1);
  }

  function renderWorld(ctx, camera, state, canvas) {
    const parallax = camera.x * 0.22;
    const backdrop = state.backdrop || pickBackdrop(state.seed || 0);

    ctx.save();
    ctx.fillStyle = "#0b0d17";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, backdrop.skyTop);
    sky.addColorStop(0.35, backdrop.skyMid);
    sky.addColorStop(0.72, backdrop.skyLow);
    sky.addColorStop(1, backdrop.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawMoon(ctx, parallax, backdrop);
    drawMeteors(ctx, state.meteors, parallax);
    drawMegacityLayer(ctx, camera, canvas, {
      offset: parallax * 0.28,
      baseY: 320,
      color: backdrop.farColor,
      glow: backdrop.farGlow,
      windowColor: backdrop.farWindow,
      seed: 13,
      minWidth: 52,
      maxWidth: 104,
      minHeight: 90,
      maxHeight: 210,
      detail: false,
    });
    drawMegacityLayer(ctx, camera, canvas, {
      offset: parallax * 0.52,
      baseY: 380,
      color: backdrop.nearColor,
      glow: backdrop.nearGlow,
      windowColor: backdrop.nearWindow,
      seed: 29,
      minWidth: 46,
      maxWidth: 96,
      minHeight: 70,
      maxHeight: 180,
      detail: true,
    });
    drawElevatedRoad(ctx, parallax, canvas, backdrop);
    drawFogBands(ctx, canvas, backdrop);
    ctx.restore();

    drawGrid(ctx, camera, state.bounds.width);
    drawSkyStrikeWarning(ctx, camera, state.skyEvent.warning, state.skyEvent.gate, state.floorConfig);
    drawSolids(ctx, camera, state.solids);
    drawHazards(ctx, camera, state.hazards);
    drawEnemies(ctx, camera, state.enemies);
    drawProjectiles(ctx, camera, state.projectiles);
    drawSkyProjectile(ctx, camera, state.skyEvent.activeProjectile);
    drawGoal(ctx, camera, state.goal);
  }

  function spawnMeteorShower(state) {
    if (typeof window.gsap === "undefined") {
      return;
    }

    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i += 1) {
      spawnMeteor(state, i * 0.22);
    }
  }

  function spawnMeteor(state, delay) {
    const meteor = {
      x: 1020 + Math.random() * 280,
      y: 40 + Math.random() * 130,
      size: 2 + Math.random() * 3,
      trail: 70 + Math.random() * 65,
      alpha: 0,
      glow: 16 + Math.random() * 14,
      done: false,
    };

    state.meteors.push(meteor);

    window.gsap.timeline({
      delay,
      onComplete: function () {
        meteor.done = true;
      },
    })
      .to(meteor, {
        alpha: 1,
        duration: 0.18,
        ease: "power1.out",
      })
      .to(meteor, {
        x: -220 - Math.random() * 120,
        y: 250 + Math.random() * 120,
        alpha: 0,
        duration: 1.8 + Math.random() * 0.8,
        ease: "power2.in",
      }, 0);
  }

  function drawMeteors(ctx, meteors, parallax) {
    for (let i = meteors.length - 1; i >= 0; i -= 1) {
      const meteor = meteors[i];
      if (meteor.done) {
        meteors.splice(i, 1);
        continue;
      }

      const px = meteor.x - parallax * 1.25;
      const py = meteor.y;
      ctx.save();
      ctx.globalAlpha = meteor.alpha;
      ctx.strokeStyle = "rgba(126, 240, 255, 0.78)";
      ctx.lineWidth = meteor.size;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + meteor.trail, py - meteor.trail * 0.38);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 120, 180, 0.28)";
      ctx.lineWidth = meteor.size * 2.2;
      ctx.beginPath();
      ctx.moveTo(px - 2, py + 1);
      ctx.lineTo(px + meteor.trail * 0.8, py - meteor.trail * 0.32);
      ctx.stroke();

      ctx.fillStyle = "#d5fbff";
      ctx.beginPath();
      ctx.arc(px, py, meteor.glow * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMoon(ctx, parallax, backdrop) {
    const x = 740 - parallax * 0.18;
    const y = 92;
    ctx.save();
    ctx.fillStyle = backdrop.moonOuter;
    ctx.beginPath();
    ctx.arc(x, y, 76, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = backdrop.moonInner;
    ctx.beginPath();
    ctx.arc(x - 8, y - 6, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMegacityLayer(ctx, camera, canvas, config) {
    const worldSpan = canvas.width + 400;
    const stepBase = config.maxWidth + 12;
    const startX = -200 - (config.offset % stepBase);
    let x = startX;
    let index = 0;

    while (x < worldSpan) {
      const width = seededRange(config.seed + index * 17, config.minWidth, config.maxWidth);
      const height = seededRange(config.seed + index * 31, config.minHeight, config.maxHeight);
      const y = config.baseY - height;
      drawBuilding(ctx, Math.round(x), Math.round(y), width, height, config, index);
      x += width + seededRange(config.seed + index * 7, 8, 18);
      index += 1;
    }
  }

  function drawBuilding(ctx, x, y, width, height, config, index) {
    ctx.fillStyle = config.color;
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = shadeColor(config.color, 18);
    ctx.fillRect(x + width - 8, y, 8, height);

    ctx.fillStyle = config.glow;
    ctx.fillRect(x - 1, y, width + 2, 3);

    const topType = (config.seed + index) % 4;
    if (topType === 0) {
      ctx.fillStyle = shadeColor(config.color, 28);
      ctx.fillRect(x + 6, y - 12, width - 12, 12);
      ctx.fillStyle = config.windowColor;
      ctx.fillRect(x + width / 2 - 2, y - 24, 4, 12);
    } else if (topType === 1) {
      ctx.fillStyle = shadeColor(config.color, 22);
      ctx.fillRect(x + width / 2 - 8, y - 18, 16, 18);
      ctx.fillStyle = config.windowColor;
      ctx.fillRect(x + width / 2 - 1, y - 28, 2, 10);
    } else if (topType === 2) {
      ctx.fillStyle = shadeColor(config.color, 14);
      ctx.fillRect(x + 8, y - 8, width - 16, 8);
    }

    for (let py = y + 8; py < y + height - 12; py += 12) {
      for (let px = x + 6; px < x + width - 10; px += 10) {
        const on = ((px + py + index * 13) % 23) < 9;
        ctx.fillStyle = on ? config.windowColor : "rgba(7, 10, 18, 0.5)";
        ctx.fillRect(px, py, 4, 6);
      }
    }

    if (config.detail) {
      ctx.fillStyle = "rgba(255, 84, 141, 0.25)";
      ctx.fillRect(x + 4, y + 18, width - 8, 2);
      if (width > 64) {
        ctx.fillStyle = "rgba(111, 231, 255, 0.3)";
        ctx.fillRect(x + 8, y + height - 18, width - 16, 2);
      }
    }
  }

  function drawElevatedRoad(ctx, parallax, canvas, backdrop) {
    const roadY = 250;
    const offset = parallax * 0.75;
    ctx.save();
    ctx.fillStyle = backdrop.road;
    ctx.fillRect(-80 - (offset % 200), roadY, canvas.width + 160, 12);
    ctx.fillStyle = backdrop.roadLight;
    for (let x = -80 - (offset % 64); x < canvas.width + 80; x += 64) {
      ctx.fillRect(x, roadY + 2, 32, 2);
    }
    ctx.fillStyle = backdrop.roadPillar;
    for (let x = -40 - (offset % 120); x < canvas.width + 80; x += 120) {
      ctx.fillRect(x, roadY + 12, 8, 34);
    }
    ctx.restore();
  }

  function drawFogBands(ctx, canvas, backdrop) {
    ctx.save();
    const fog = ctx.createLinearGradient(0, 180, 0, canvas.height);
    fog.addColorStop(0, backdrop.fogTop);
    fog.addColorStop(0.55, backdrop.fogMid);
    fog.addColorStop(1, backdrop.fogBottom);
    ctx.fillStyle = fog;
    ctx.fillRect(0, 180, canvas.width, canvas.height - 180);
    ctx.restore();
  }

  function seededRange(seed, min, max) {
    const wave = Math.sin(seed * 12.9898) * 43758.5453;
    const normalized = wave - Math.floor(wave);
    return Math.round(min + normalized * (max - min));
  }

  function shadeColor(hex, amount) {
    const clean = hex.replace("#", "");
    const num = parseInt(clean, 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
    const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function drawGrid(ctx, camera, worldWidth) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    const startX = Math.floor(camera.x / TILE) * TILE - TILE;
    const endX = camera.x + 960 + TILE;

    for (let x = startX; x <= endX; x += TILE) {
      ctx.beginPath();
      ctx.moveTo(Math.floor(x - camera.x) + 0.5, 0);
      ctx.lineTo(Math.floor(x - camera.x) + 0.5, 540);
      ctx.stroke();
    }

    for (let y = 0; y <= 540; y += TILE) {
      ctx.beginPath();
      ctx.moveTo(Math.max(-camera.x, -1), y + 0.5);
      ctx.lineTo(Math.min(worldWidth - camera.x, 960), y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSolids(ctx, camera, solids) {
    solids.forEach((solid) => {
      const width = solid.bounds.max.x - solid.bounds.min.x;
      const height = solid.bounds.max.y - solid.bounds.min.y;
      const x = solid.position.x - width / 2 - camera.x;
      const y = solid.position.y - height / 2 - camera.y;

      const isGround = solid.label === "ground";
      ctx.fillStyle = isGround ? "#1b2639" : "#273754";
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));

      ctx.fillStyle = isGround ? "#314a74" : "#37517b";
      for (let px = 0; px < width; px += 16) {
        ctx.fillRect(Math.round(x + px), Math.round(y), 14, 6);
      }

      ctx.fillStyle = "#101725";
      ctx.fillRect(Math.round(x), Math.round(y + height - 8), Math.round(width), 8);
    });
  }

  function drawHazards(ctx, camera, hazards) {
    hazards.forEach((hazard) => {
      const x = hazard.x - hazard.width / 2 - camera.x;
      const y = hazard.y - hazard.height / 2 - camera.y;
      ctx.fillStyle = "#43111b";
      ctx.fillRect(Math.round(x), Math.round(y + 8), Math.round(hazard.width), Math.round(hazard.height - 8));
      ctx.fillStyle = "#ff586d";
      for (let i = 0; i < hazard.width; i += 16) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + hazard.height);
        ctx.lineTo(x + i + 8, y);
        ctx.lineTo(x + i + 16, y + hazard.height);
        ctx.fill();
      }
    });
  }

  function drawEnemies(ctx, camera, enemies) {
    enemies.forEach((enemy) => {
      if (!enemy.alive) {
        return;
      }

      const x = enemy.body.position.x - camera.x;
      const y = enemy.body.position.y - camera.y;

      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.scale(enemy.direction, 1);

      ctx.fillStyle = enemy.hitFlash > 0 ? "#f3f6ff" : "#3f4d33";
      ctx.fillRect(-13, -22, 26, 40);

      ctx.fillStyle = "#5a6a45";
      ctx.fillRect(-11, -20, 22, 24);

      ctx.fillStyle = "#2e3926";
      ctx.fillRect(-12, -8, 24, 12);

      ctx.fillStyle = "#c69b73";
      ctx.fillRect(-8, -28, 16, 8);

      ctx.fillStyle = "#556246";
      ctx.fillRect(-12, -34, 24, 8);
      ctx.fillRect(-8, -38, 16, 5);

      ctx.fillStyle = "#1b2118";
      ctx.fillRect(-10, -22, 20, 3);

      ctx.fillStyle = "#74865b";
      ctx.fillRect(-17, -8, 8, 17);
      ctx.fillRect(9, -10, 8, 15);

      ctx.fillStyle = "#2f3b2a";
      ctx.fillRect(-12, 18, 10, 18);
      ctx.fillRect(2, 18, 10, 18);

      ctx.fillStyle = "#161b14";
      ctx.fillRect(-13, 34, 11, 4);
      ctx.fillRect(2, 34, 11, 4);

      ctx.fillStyle = "#2a2f2b";
      ctx.fillRect(6, -7, 24, 4);
      ctx.fillRect(10, -4, 18, 3);

      ctx.fillStyle = "#8ce4ff";
      ctx.fillRect(24, -6, 5, 2);
      ctx.restore();
    });
  }

  function drawProjectiles(ctx, camera, projectiles) {
    projectiles.forEach((projectile) => {
      const x = projectile.body.position.x - camera.x;
      const y = projectile.body.position.y - camera.y;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.fillStyle = "#7ef0ff";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(126, 240, 255, 0.35)";
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawSkyStrikeWarning(ctx, camera, warning, gate, floorConfig) {
    const target = warning || gate;
    if (!target) {
      return;
    }

    const x = target.x - camera.x;
    const width = target.width;
    const topY = floorConfig.centerY - floorConfig.height / 2 - camera.y;

    ctx.save();
    if (warning) {
      const pulse = 0.45 + Math.sin(warning.timer * 0.35) * 0.25;
      ctx.fillStyle = `rgba(255, 92, 120, ${pulse})`;
      ctx.fillRect(Math.round(x - width / 2), Math.round(topY - 4), Math.round(width), 8);
      ctx.strokeStyle = "rgba(255, 180, 200, 0.45)";
      ctx.beginPath();
      ctx.moveTo(Math.round(x), 0);
      ctx.lineTo(Math.round(x), Math.round(topY));
      ctx.stroke();
    }

    if (gate) {
      ctx.fillStyle = "rgba(255, 84, 118, 0.22)";
      ctx.fillRect(Math.round(x - width / 2), Math.round(topY), Math.round(width), 18);
      ctx.fillStyle = "#ff7d93";
      ctx.fillRect(Math.round(x - width / 2), Math.round(topY), 6, 22);
      ctx.fillRect(Math.round(x + width / 2 - 6), Math.round(topY), 6, 22);
    }
    ctx.restore();
  }

  function drawSkyProjectile(ctx, camera, projectile) {
    if (!projectile) {
      return;
    }

    const x = projectile.body.position.x - camera.x;
    const y = projectile.body.position.y - camera.y;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.fillStyle = "#ffd9a8";
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 150, 96, 0.34)";
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 220, 160, 0.65)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -54);
    ctx.stroke();
    ctx.restore();
  }

  function drawGoal(ctx, camera, goal) {
    const x = goal.x - camera.x;
    const y = goal.y - camera.y;

    ctx.save();
    ctx.fillStyle = "#101625";
    ctx.fillRect(Math.round(x - 8), Math.round(y + 34), 16, 114);
    ctx.fillStyle = "#2fe2ff";
    ctx.fillRect(Math.round(x), Math.round(y), 8, 72);
    ctx.fillStyle = "rgba(47, 226, 255, 0.2)";
    ctx.fillRect(Math.round(x + 8), Math.round(y), 24, 72);
    ctx.fillStyle = "#f6d27d";
    ctx.fillRect(Math.round(x - 18), Math.round(y - 8), 36, 10);
    ctx.restore();
  }

  window.GameWorld = {
    TILE,
    createWorld,
    buildLevel,
    updateEnemies,
    updateCombat,
    updateSkyEvent,
    removeProjectile,
    spawnMeteorShower,
    finishSkyStrike,
    renderWorld,
  };
}());
