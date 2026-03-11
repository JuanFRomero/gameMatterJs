(function () {
  const {
    Bodies,
    Body,
    Composite,
    Constraint,
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
      difficulty: getDifficultyConfig("medium"),
      mode: "standard",
      skin: getSkinConfig("neon"),
      bounds: { width: 3200, height: 1400 },
      spawn: { x: 160, y: 320 },
      goal: { x: 0, y: 0, width: 96, height: 160 },
      worldSolids: [],
      floorBodies: [],
      solids: [],
      climbWalls: [],
      pegs: [],
      bouncers: [],
      scoreSlots: [],
      ramps: [],
      doors: [],
      teleports: [],
      hazards: [],
      enemies: [],
      projectiles: [],
      playerProjectiles: [],
      explosions: [],
      meteors: [],
      teleportCooldown: 0,
      boardConfig: null,
      floorConfig: {
        centerY: 690,
        height: 320,
      },
      skyEvent: {
        cooldown: 240,
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
    state.climbWalls.forEach((wall) => Composite.remove(engine.world, wall.body));
    state.pegs.forEach((peg) => Composite.remove(engine.world, peg.body));
    state.bouncers.forEach((bouncer) => Composite.remove(engine.world, bouncer.body));
    state.scoreSlots.forEach((slot) => Composite.remove(engine.world, slot.body));
    state.ramps.forEach((ramp) => Composite.remove(engine.world, ramp.body));
    state.doors.forEach((door) => Composite.remove(engine.world, door.body));
    state.teleports.forEach((teleport) => Composite.remove(engine.world, teleport.body));
    state.hazards.forEach((hazard) => Composite.remove(engine.world, hazard.body));
    state.enemies.forEach((enemy) => Composite.remove(engine.world, enemy.body));
    state.projectiles.forEach((projectile) => Composite.remove(engine.world, projectile.body));
    state.playerProjectiles.forEach((projectile) => {
      Composite.remove(engine.world, projectile.body);
      if (projectile.constraint) {
        Composite.remove(engine.world, projectile.constraint);
      }
    });
    state.explosions = [];
    if (state.skyEvent.activeProjectile) {
      Composite.remove(engine.world, state.skyEvent.activeProjectile.body);
    }
  }

  function buildLevel(engine, state, levelNumber) {
    clearBodies(engine, state);

    const randomSeed = Math.floor(Math.random() * 4294967295);
    const rng = makeRng(randomSeed);
    const layoutTheme = pickLayoutTheme(randomSeed);
    const difficulty = state.difficulty || getDifficultyConfig("medium");
    const levelScaling = getLevelScaling(levelNumber, difficulty);
    const skin = state.skin || getSkinConfig("neon");
    const solids = [];
    const climbWalls = [];
    const pegs = [];
    const bouncers = [];
    const scoreSlots = [];
    const ramps = [];
    const doors = [];
    const teleports = [];
    const hazards = [];
    const enemies = [];
    const projectiles = [];
    const playerProjectiles = [];
    const explosions = [];
    const levelWidth = Math.round(
      (layoutTheme.baseWidth + Math.min(levelNumber * layoutTheme.levelGrowth, layoutTheme.maxGrowth)) * difficulty.levelScale * levelScaling.widthScale
    );
    const bounds = { width: levelWidth, height: 1400 };
    state.floorConfig = {
      centerY: 690,
      height: 320,
    };

    let cursorX = 220;
    let enemyId = 0;
    const laneY = [590, 505, 415, 325, 240];
    const sectionCount = Math.max(8, 9 + Math.min(levelNumber, 4) + difficulty.sectionBonus + levelScaling.sectionBonus);
    const segmentPatterns = layoutTheme.segmentPatterns;
    const sectionWidth = levelWidth / sectionCount;
    const progressBuckets = {
      hazard: [0, 0, 0, 0, 0],
      peg: [0, 0, 0, 0, 0],
      bouncer: [0, 0, 0, 0, 0],
      enemy: [0, 0, 0, 0, 0],
    };
    const spacing = {
      hazard: 0,
      peg: 0,
      bouncer: 0,
      enemy: 0,
      wall: 0,
    };

    const startPlatform = makeBody(240, laneY[0], 320, 28);
    solids.push(startPlatform);

    for (let section = 0; section < sectionCount; section += 1) {
      const pattern = segmentPatterns[section % segmentPatterns.length];
      const sectionStart = 220 + section * sectionWidth;
      const sectionCenter = sectionStart + sectionWidth / 2;
      const mainLane = getSectionLane(pattern, rng, laneY);
      const mainY = laneY[mainLane];
      const mainWidth = snapToTile(Math.min(sectionWidth - 80, randInt(rng, 260, 420) * difficulty.zoneScale * levelScaling.zoneScale));
      const mainX = sectionCenter;
      const bucket = Math.min(
        progressBuckets.hazard.length - 1,
        Math.floor((sectionCenter / levelWidth) * progressBuckets.hazard.length)
      );

      solids.push(makeBody(mainX, mainY, mainWidth, 24));

      if (pattern === "fortified" || pattern === "industrial") {
        solids.push(makeBody(mainX, mainY - 92, snapToTile(randInt(rng, 160, 240)), 18));
      }

      if (pattern === "upper" || pattern === "vertical" || pattern === "ruins") {
        const upperCount = pattern === "vertical" ? 3 : 2;
        for (let i = 0; i < upperCount; i += 1) {
          const upperWidth = snapToTile(randInt(rng, 96, 180));
          const upperX = sectionCenter + (i - (upperCount - 1) / 2) * 120;
          const upperY = mainY - 110 - i * randInt(rng, 34, 60);
          solids.push(makeBody(upperX, upperY, upperWidth, 18));
        }
      }

      if (pattern === "lower" || pattern === "canyon") {
        for (let i = 0; i < 2; i += 1) {
          const lowerWidth = snapToTile(randInt(rng, 130, 220));
          const lowerX = sectionCenter + (i === 0 ? -120 : 120);
          const lowerY = mainY + randInt(rng, 70, 130);
          solids.push(makeBody(lowerX, lowerY, lowerWidth, 18));
        }
      }

      if (pattern === "stair") {
        const dir = rng() > 0.5 ? 1 : -1;
        const stairBaseY = mainY + 20;
        for (let s = 0; s < 4; s += 1) {
          solids.push(makeBody(
            sectionCenter + dir * (s * 86 - 120),
            stairBaseY - s * 34,
            116,
            18
          ));
        }
      }

      if (spacing.wall <= 0 && (pattern === "vertical" || pattern === "fortified" || rng() > layoutTheme.wallChance)) {
        const wallCount = pattern === "vertical" ? 2 : 1;
        for (let w = 0; w < wallCount; w += 1) {
          const wallHeight = randInt(rng, 150, pattern === "vertical" ? 260 : 220);
          const wallX = sectionCenter + (w === 0 ? -mainWidth / 2 + 12 : mainWidth / 2 - 12);
          const wallY = mainY - wallHeight / 2 - 14;
          climbWalls.push(makeClimbWall(wallX, wallY, 20, wallHeight));
        }
        spacing.wall = 1;
      }

      if (spacing.enemy <= 0) {
        let enemySlots = pattern === "fortified" || pattern === "vertical" ? 2 : 1;
        if (difficulty.enemyDensity > 1 && rng() < difficulty.enemyDensity - 1) {
          enemySlots += 1;
        } else if (difficulty.enemyDensity < 1 && enemySlots > 1 && rng() > difficulty.enemyDensity) {
          enemySlots -= 1;
        }
        if (rng() < levelScaling.extraEnemyChance) {
          enemySlots += 1;
        }
        for (let e = 0; e < enemySlots; e += 1) {
          const enemyX = sectionCenter + (e - (enemySlots - 1) / 2) * 72;
          const enemyY = mainY - 42 - Math.min(92, e * 46);
          enemies.push(makeEnemy(enemyId, enemyX, enemyY, enemySlots === 2 ? 160 : mainWidth, levelNumber, rng, difficulty, levelScaling));
          enemyId += 1;
          progressBuckets.enemy[bucket] += 1;
        }
        spacing.enemy = 1;
      }

      if (spacing.hazard <= 0 && section > 0) {
        const hazardX = sectionStart - 40;
        const hazardWidth = snapToTile(randInt(rng, 96, 170) * levelScaling.hazardScale);
        const pitHazard = mainY < 560 && rng() < levelScaling.pitSpikeChance;
        const hazardY = pitHazard ? mainY + randInt(rng, 108, 166) : 642;
        const hazardHeight = pitHazard ? 26 : 18;
        hazards.push(makeHazard(hazardX, hazardY, hazardWidth, hazardHeight, pitHazard ? "pit" : "ledge"));
        progressBuckets.hazard[bucket] += 1;
        spacing.hazard = 1;
      }

      if (spacing.peg <= 0) {
        const pegCount = Math.max(1, Math.round((pattern === "vertical" ? 2 : 1) * difficulty.pegDensity));
        for (let p = 0; p < pegCount; p += 1) {
          pegs.push(makePeg(
            sectionCenter + randInt(rng, -140, 140),
            mainY - randInt(rng, 90, 210),
            randInt(rng, 10, 24),
            skin
          ));
        }
        progressBuckets.peg[bucket] += 1;
        spacing.peg = 1;
      }

      if (spacing.bouncer <= 0 && (pattern === "lower" || pattern === "stair" || rng() > 0.6)) {
        const bouncerY = pattern === "lower" ? mainY + 92 : mainY - 18;
        bouncers.push(makeBouncer(sectionCenter + randInt(rng, -90, 90), bouncerY, randInt(rng, 54, 76), skin));
        progressBuckets.bouncer[bucket] += 1;
        spacing.bouncer = 1;
      }

      if (state.mode === "circuit") {
        if (pattern === "stair" || pattern === "lower" || rng() > 0.62) {
          const rampDir = rng() > 0.5 ? 1 : -1;
          ramps.push(makeRamp(
            sectionCenter + rampDir * 90,
            mainY + 10,
            132,
            18,
            rampDir * -0.34,
            skin
          ));
        }

        if (pattern === "fortified" || pattern === "vertical") {
          doors.push(makeDoor(sectionCenter + randInt(rng, -54, 54), mainY - 48, 28, 92, randInt(rng, 140, 220), skin));
        }
      }

      spacing.hazard -= 1;
      spacing.peg -= 1;
      spacing.bouncer -= 1;
      spacing.enemy -= 1;
      spacing.wall -= 1;
      cursorX = sectionCenter;
    }

    const finishX = levelWidth - 220;
    const finishY = laneY[1];
    solids.push(makeBody(finishX - 120, finishY + 72, 300, 24));
    if (state.mode === "standard") {
      createScoreSlots(scoreSlots, finishX, finishY + 118, rng, skin);
    }

    if (state.mode === "circuit") {
      const leftTeleport = makeTeleport(finishX * 0.32, laneY[0] + 18, 18, 1, skin);
      const rightTeleport = makeTeleport(finishX * 0.72, laneY[2] + 18, 18, 0, skin);
      teleports.push(leftTeleport, rightTeleport);
    }

    const walls = [
      makeBody(-40, 250, 80, 800, { label: "wall" }),
      makeBody(bounds.width + 40, 250, 80, 800, { label: "wall" }),
    ];
    walls.forEach((wall) => solids.push(wall));

    Composite.add(engine.world, [
      ...solids,
      ...climbWalls.map((wall) => wall.body),
      ...pegs.map((peg) => peg.body),
      ...bouncers.map((bouncer) => bouncer.body),
      ...scoreSlots.map((slot) => slot.body),
      ...ramps.map((ramp) => ramp.body),
      ...doors.map((door) => door.body),
      ...teleports.map((teleport) => teleport.body),
      ...hazards.map((hazard) => hazard.body),
      ...enemies.map((enemy) => enemy.body),
    ]);

    state.level = levelNumber;
    state.seed = randomSeed;
    state.layoutTheme = layoutTheme.name;
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
    state.climbWalls = climbWalls;
    state.pegs = pegs;
    state.bouncers = bouncers;
    state.scoreSlots = scoreSlots;
    state.ramps = ramps;
    state.doors = doors;
    state.teleports = teleports;
    state.hazards = hazards;
    state.enemies = enemies;
    state.projectiles = projectiles;
    state.playerProjectiles = playerProjectiles;
    state.explosions = explosions;
    state.teleportCooldown = 0;
    state.skyEvent = {
      cooldown: levelScaling.skyCooldown,
      warning: null,
      activeProjectile: null,
      gate: null,
    };
    state.boardConfig = captureBoardConfig(state, skin, difficulty);
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

  function pickLayoutTheme(seed) {
    const themes = [
      {
        name: "industrial",
        baseWidth: 4600,
        levelGrowth: 420,
        maxGrowth: 3600,
        platformBase: 18,
        platformCap: 16,
        hazardChance: 0.54,
        enemyChance: 0.12,
        pegGuaranteedChance: 0.42,
        pegBonusChance: 0.8,
        bouncerGuaranteedChance: 0.5,
        bouncerBonusChance: 0.86,
        wallChance: 0.52,
        wallHeightTrigger: 64,
        stepChance: 0.48,
        lowerChance: 0.62,
        segmentPatterns: ["fortified", "vertical", "upper", "fortified", "lower"],
        sectionProfiles: [
          { gapMin: 110, gapMax: 150, widthMin: 220, widthMax: 320, deltaMin: -28, deltaMax: 18, minY: 470, maxY: 590 },
          { gapMin: 120, gapMax: 175, widthMin: 180, widthMax: 260, deltaMin: -68, deltaMax: 16, minY: 370, maxY: 540 },
          { gapMin: 105, gapMax: 150, widthMin: 240, widthMax: 360, deltaMin: -24, deltaMax: 24, minY: 390, maxY: 520 },
          { gapMin: 120, gapMax: 185, widthMin: 170, widthMax: 260, deltaMin: -18, deltaMax: 76, minY: 300, maxY: 500 },
          { gapMin: 115, gapMax: 170, widthMin: 220, widthMax: 320, deltaMin: -24, deltaMax: 22, minY: 340, maxY: 510 },
        ],
      },
      {
        name: "canyon",
        baseWidth: 5000,
        levelGrowth: 460,
        maxGrowth: 3800,
        platformBase: 17,
        platformCap: 15,
        hazardChance: 0.5,
        enemyChance: 0.1,
        pegGuaranteedChance: 0.5,
        pegBonusChance: 0.84,
        bouncerGuaranteedChance: 0.62,
        bouncerBonusChance: 0.9,
        wallChance: 0.48,
        wallHeightTrigger: 86,
        stepChance: 0.52,
        lowerChance: 0.58,
        segmentPatterns: ["lower", "stair", "upper", "stair", "lower"],
        sectionProfiles: [
          { gapMin: 120, gapMax: 190, widthMin: 200, widthMax: 300, deltaMin: 0, deltaMax: 44, minY: 500, maxY: 610 },
          { gapMin: 130, gapMax: 200, widthMin: 170, widthMax: 250, deltaMin: -18, deltaMax: 88, minY: 420, maxY: 610 },
          { gapMin: 150, gapMax: 230, widthMin: 160, widthMax: 230, deltaMin: -36, deltaMax: 96, minY: 360, maxY: 590 },
          { gapMin: 140, gapMax: 210, widthMin: 150, widthMax: 240, deltaMin: -42, deltaMax: 92, minY: 320, maxY: 560 },
          { gapMin: 120, gapMax: 185, widthMin: 210, widthMax: 320, deltaMin: -26, deltaMax: 30, minY: 360, maxY: 520 },
        ],
      },
      {
        name: "fortress",
        baseWidth: 4400,
        levelGrowth: 400,
        maxGrowth: 3200,
        platformBase: 19,
        platformCap: 14,
        hazardChance: 0.56,
        enemyChance: 0.08,
        pegGuaranteedChance: 0.4,
        pegBonusChance: 0.78,
        bouncerGuaranteedChance: 0.56,
        bouncerBonusChance: 0.88,
        wallChance: 0.62,
        wallHeightTrigger: 58,
        stepChance: 0.36,
        lowerChance: 0.74,
        segmentPatterns: ["fortified", "upper", "fortified", "vertical", "fortified"],
        sectionProfiles: [
          { gapMin: 95, gapMax: 135, widthMin: 240, widthMax: 360, deltaMin: -24, deltaMax: 14, minY: 460, maxY: 580 },
          { gapMin: 100, gapMax: 150, widthMin: 220, widthMax: 330, deltaMin: -72, deltaMax: 8, minY: 360, maxY: 520 },
          { gapMin: 90, gapMax: 130, widthMin: 260, widthMax: 380, deltaMin: -18, deltaMax: 18, minY: 390, maxY: 510 },
          { gapMin: 100, gapMax: 150, widthMin: 220, widthMax: 330, deltaMin: -10, deltaMax: 82, minY: 320, maxY: 500 },
          { gapMin: 90, gapMax: 140, widthMin: 240, widthMax: 360, deltaMin: -18, deltaMax: 20, minY: 350, maxY: 500 },
        ],
      },
      {
        name: "ruins",
        baseWidth: 4700,
        levelGrowth: 430,
        maxGrowth: 3500,
        platformBase: 18,
        platformCap: 15,
        hazardChance: 0.52,
        enemyChance: 0.1,
        pegGuaranteedChance: 0.45,
        pegBonusChance: 0.82,
        bouncerGuaranteedChance: 0.55,
        bouncerBonusChance: 0.88,
        wallChance: 0.54,
        wallHeightTrigger: 70,
        stepChance: 0.44,
        lowerChance: 0.6,
        segmentPatterns: ["upper", "lower", "stair", "vertical", "upper"],
        sectionProfiles: [
          { gapMin: 115, gapMax: 165, widthMin: 200, widthMax: 300, deltaMin: -54, deltaMax: 26, minY: 450, maxY: 590 },
          { gapMin: 125, gapMax: 185, widthMin: 170, widthMax: 260, deltaMin: -92, deltaMax: 28, minY: 340, maxY: 560 },
          { gapMin: 110, gapMax: 160, widthMin: 210, widthMax: 320, deltaMin: -24, deltaMax: 34, minY: 370, maxY: 520 },
          { gapMin: 130, gapMax: 195, widthMin: 150, widthMax: 250, deltaMin: -34, deltaMax: 84, minY: 310, maxY: 520 },
          { gapMin: 115, gapMax: 170, widthMin: 210, widthMax: 310, deltaMin: -28, deltaMax: 28, minY: 350, maxY: 520 },
        ],
      },
    ];

    return themes[seed % themes.length];
  }

  function getDifficultyConfig(key) {
    const configs = {
      easy: {
        key: "easy",
        label: "Facil",
        enemyDensity: 0.75,
        pegDensity: 0.8,
        enemySpeed: 0.86,
        shootCooldown: 1.25,
        projectileSpeed: 0.88,
        skyCooldown: 300,
        levelScale: 0.94,
        sectionBonus: -1,
        zoneScale: 0.9,
      },
      medium: {
        key: "medium",
        label: "Medio",
        enemyDensity: 1,
        pegDensity: 1,
        enemySpeed: 1,
        shootCooldown: 1,
        projectileSpeed: 1,
        skyCooldown: 240,
        levelScale: 1,
        sectionBonus: 0,
        zoneScale: 1,
      },
      hard: {
        key: "hard",
        label: "Dificil",
        enemyDensity: 1.35,
        pegDensity: 1.4,
        enemySpeed: 1.18,
        shootCooldown: 0.78,
        projectileSpeed: 1.2,
        skyCooldown: 180,
        levelScale: 1.08,
        sectionBonus: 1,
        zoneScale: 1.1,
      },
    };

    return configs[key] || configs.medium;
  }

  function getLevelScaling(levelNumber, difficulty) {
    const tier = Math.max(0, Math.min(levelNumber - 1, 9));
    return {
      widthScale: 1 + tier * 0.018,
      sectionBonus: Math.floor(tier / 3),
      zoneScale: 1 + tier * 0.015,
      enemySpeed: 1 + tier * 0.055,
      projectileSpeed: 1 + tier * 0.05,
      shootCooldown: Math.max(0.48, difficulty.shootCooldown - tier * 0.025),
      skyCooldown: Math.max(96, Math.round(difficulty.skyCooldown - tier * 12)),
      extraEnemyChance: Math.min(0.55, tier * 0.06),
      hazardScale: 1 + tier * 0.05,
      pitSpikeChance: Math.min(0.72, 0.18 + tier * 0.05),
    };
  }

  function getSkinConfig(key) {
    const skins = {
      neon: {
        key: "neon",
        label: "Neon",
        solidBase: "#273754",
        solidTop: "#37517b",
        groundBase: "#1b2639",
        groundTop: "#314a74",
        pegOuter: "#1f273c",
        pegCore: "#7ef0ff",
        pegLight: "#d9fbff",
        bouncerBase: "#17324a",
        bouncerGlow: "#7ef0ff",
        bouncerLight: "#d2fbff",
        rampBase: "#214261",
        doorBase: "#203652",
        doorGlow: "#7ef0ff",
        teleportOuter: "#10253e",
        teleportGlow: "#89f4ff",
        chamfer: 6,
      },
      amber: {
        key: "amber",
        label: "Amber",
        solidBase: "#493424",
        solidTop: "#8a6238",
        groundBase: "#2b2219",
        groundTop: "#6b5230",
        pegOuter: "#31261e",
        pegCore: "#ffbf69",
        pegLight: "#fff2ca",
        bouncerBase: "#49341d",
        bouncerGlow: "#ffc46c",
        bouncerLight: "#fff0bf",
        rampBase: "#5f4420",
        doorBase: "#49301c",
        doorGlow: "#ffd074",
        teleportOuter: "#352417",
        teleportGlow: "#ffe088",
        chamfer: 10,
      },
      crimson: {
        key: "crimson",
        label: "Crimson",
        solidBase: "#4a2137",
        solidTop: "#8d3b65",
        groundBase: "#291322",
        groundTop: "#65304d",
        pegOuter: "#311527",
        pegCore: "#ff6ea7",
        pegLight: "#ffd1e7",
        bouncerBase: "#4a1d33",
        bouncerGlow: "#ff70b0",
        bouncerLight: "#ffd4eb",
        rampBase: "#632744",
        doorBase: "#482238",
        doorGlow: "#ff7fbb",
        teleportOuter: "#341426",
        teleportGlow: "#ffa8d1",
        chamfer: 14,
      },
    };

    return skins[key] || skins.neon;
  }

  function getSectionLane(pattern, rng, laneY) {
    const laneCount = laneY.length - 1;

    if (pattern === "fortified") {
      return randInt(rng, 0, Math.min(1, laneCount));
    }

    if (pattern === "industrial") {
      return randInt(rng, 1, Math.min(2, laneCount));
    }

    if (pattern === "upper") {
      return randInt(rng, 1, Math.min(2, laneCount));
    }

    if (pattern === "vertical") {
      return randInt(rng, 1, Math.min(3, laneCount));
    }

    if (pattern === "stair") {
      return randInt(rng, 1, Math.min(2, laneCount));
    }

    if (pattern === "lower" || pattern === "canyon") {
      return randInt(rng, 0, Math.min(1, laneCount));
    }

    if (pattern === "ruins") {
      return randInt(rng, 1, Math.min(3, laneCount));
    }

    return randInt(rng, 0, laneCount);
  }

  function makeHazard(x, y, width, height, kind) {
    const body = makeBody(x, y, width, height, {
      isSensor: true,
      label: "hazard",
    });

    return { body, x, y, width, height, kind: kind || "ledge" };
  }

  function makeEnemy(id, x, y, platformWidth, levelNumber, rng, difficulty, levelScaling) {
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
      speed: (1.3 + Math.min(levelNumber * 0.08, 1) + randRange(rng, 0, 0.5)) * difficulty.enemySpeed * levelScaling.enemySpeed,
      direction: rng() > 0.5 ? 1 : -1,
      alive: true,
      hitFlash: 0,
      shootCooldown: Math.max(24, Math.round(randInt(rng, 45, 180) * levelScaling.shootCooldown)),
    };
  }

  function makePeg(x, y, radius, skin) {
    const body = Bodies.circle(x, y, radius, {
      isStatic: true,
      friction: 0.2,
      restitution: 1.05,
      label: "peg",
      render: { visible: false },
    });

    return {
      body,
      radius,
      skinKey: skin.key,
    };
  }

  function makeClimbWall(x, y, width, height) {
    const body = makeBody(x, y, width, height, {
      friction: 0.2,
      restitution: 0,
      label: "climbWall",
    });

    return {
      body,
      width,
      height,
    };
  }

  function makeBouncer(x, y, width, skin) {
    const body = makeBody(x, y, width, 16, {
      friction: 0.1,
      restitution: 1.2,
      label: "bouncer",
      chamfer: { radius: skin.chamfer },
    });

    return {
      body,
      width,
      height: 16,
      skinKey: skin.key,
    };
  }

  function makeScoreSlot(x, y, width, height, value, label, skin) {
    const body = Bodies.rectangle(x, y, width, height, {
      isStatic: true,
      isSensor: true,
      label: "scoreSlot",
      chamfer: { radius: Math.max(6, skin.chamfer) },
      render: { visible: false },
    });

    return {
      body,
      width,
      height,
      value,
      label,
      claimed: false,
    };
  }

  function createScoreSlots(scoreSlots, centerX, baseY, rng, skin) {
    const count = randInt(rng, 3, 6);
    const slotWidth = 64;
    const slotHeight = 84;
    const gap = 8;
    const totalWidth = count * slotWidth + (count - 1) * gap;
    const startX = centerX - totalWidth / 2 + slotWidth / 2;
    const topValue = 250 * count;

    for (let i = 0; i < count; i += 1) {
      const value = Math.max(250, topValue - i * 250);
      scoreSlots.push(makeScoreSlot(
        startX + i * (slotWidth + gap),
        baseY,
        slotWidth,
        slotHeight,
        value,
        `x${count - i}`,
        skin
      ));
    }
  }

  function makeRamp(x, y, width, height, angle, skin) {
    const body = Bodies.rectangle(x, y, width, height, {
      isStatic: true,
      friction: 0.8,
      restitution: 0,
      label: "ramp",
      chamfer: { radius: Math.max(4, skin.chamfer - 2) },
      render: { visible: false },
    });
    Body.setAngle(body, angle);
    return { body, width, height, angle, skinKey: skin.key };
  }

  function makeDoor(x, y, width, height, cycle, skin) {
    const body = makeBody(x, y, width, height, {
      label: "door",
      chamfer: { radius: skin.chamfer },
    });
    return {
      body,
      width,
      height,
      cycle,
      timer: cycle,
      open: false,
      skinKey: skin.key,
    };
  }

  function makeTeleport(x, y, radius, pairIndex, skin) {
    const body = Bodies.circle(x, y, radius, {
      isStatic: true,
      isSensor: true,
      label: "teleport",
      render: { visible: false },
    });
    return {
      body,
      radius,
      pairIndex,
      skinKey: skin.key,
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
        enemy.shootCooldown = Math.max(24, Math.round(45 * Math.max(0.48, state.difficulty.shootCooldown - Math.min(state.level - 1, 9) * 0.025)));
        return;
      }

      const distance = Math.max(1, Math.hypot(dx, dy));
      const direction = dx >= 0 ? 1 : -1;
      enemy.direction = direction;
      spawnProjectile(engine, state, {
        x: enemy.body.position.x + direction * 24,
        y: enemy.body.position.y - 10,
        vx: (dx / distance) * 6.2 * state.difficulty.projectileSpeed * (1 + Math.min(state.level - 1, 9) * 0.05),
        vy: (dy / distance) * 1.2 * state.difficulty.projectileSpeed * (1 + Math.min(state.level - 1, 9) * 0.05),
      });
      GameAudio.playEnemyShot();
      enemy.shootCooldown = Math.max(24, Math.round(180 * Math.max(0.48, state.difficulty.shootCooldown - Math.min(state.level - 1, 9) * 0.025)));
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
    state.skyEvent.cooldown = Math.max(96, Math.round(state.difficulty.skyCooldown - Math.min(state.level - 1, 9) * 12));
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

  function spawnRyanSpecial(engine, state, player) {
    const body = Bodies.circle(player.body.position.x, player.body.position.y - 18, 12, {
      label: "playerProjectile",
      frictionAir: 0.01,
      restitution: 0.18,
      density: 0.0035,
      render: { visible: false },
    });
    const anchor = {
      x: player.body.position.x - player.facing * 34,
      y: player.body.position.y - 8,
    };
    const constraint = Constraint.create({
      pointA: anchor,
      bodyB: body,
      stiffness: 0.045,
      damping: 0.04,
      length: 34,
      render: { visible: false },
    });
    const target = pickRyanTarget(state, player);
    const aimDx = target ? target.body.position.x - player.body.position.x : player.facing * 360;
    const aimDy = target ? target.body.position.y - player.body.position.y : -120;

    Composite.add(engine.world, [body, constraint]);
    state.playerProjectiles.push({
      body,
      constraint,
      anchor,
      releaseTimer: 12,
      launched: false,
      life: 210,
      targetVx: Math.max(-13, Math.min(13, aimDx / 22)),
      targetVy: Math.max(-12, Math.min(6, aimDy / 28)) - 5.5,
      damage: 4,
      owner: "sniper",
      kind: "slingshot",
    });
  }

  function spawnRyanBullet(engine, state, player, charged) {
    const body = Bodies.circle(
      player.body.position.x + player.facing * 26,
      player.body.position.y - 10,
      charged ? 8 : 6,
      {
        label: "playerProjectile",
        frictionAir: 0,
        restitution: 0,
        isSensor: true,
        render: { visible: false },
      }
    );

    const speed = charged ? 16 : 13;
    const projectile = {
      body,
      constraint: null,
      anchor: null,
      releaseTimer: 0,
      launched: true,
      life: charged ? 120 : 96,
      targetVx: 0,
      targetVy: 0,
      damage: charged ? 3 : 1,
      owner: "sniper",
      kind: charged ? "sniperHeavy" : "sniperShot",
    };

    state.playerProjectiles.push(projectile);
    Composite.add(engine.world, body);
    Body.setVelocity(body, {
      x: player.facing * speed,
      y: charged ? -0.2 : 0,
    });
  }

  function spawnRoninShuriken(engine, state, player) {
    const body = Bodies.circle(
      player.body.position.x + player.facing * 22,
      player.body.position.y - 12,
      9,
      {
        label: "playerProjectile",
        frictionAir: 0.002,
        restitution: 0,
        isSensor: true,
        render: { visible: false },
      }
    );

    const projectile = {
      body,
      constraint: null,
      anchor: null,
      releaseTimer: 0,
      launched: true,
      life: 110,
      targetVx: 0,
      targetVy: 0,
      damage: 2,
      owner: "ronin",
      kind: "shuriken",
    };

    state.playerProjectiles.push(projectile);
    Composite.add(engine.world, body);
    Body.setAngularVelocity(body, player.facing * 0.7);
    Body.setVelocity(body, {
      x: player.facing * 11.5,
      y: player.onGround ? -0.4 : -0.9,
    });
  }

  function pickRyanTarget(state, player) {
    let best = null;
    let bestDistance = Infinity;
    state.enemies.forEach((enemy) => {
      if (!enemy.alive) {
        return;
      }
      const dx = enemy.body.position.x - player.body.position.x;
      if (Math.sign(dx) !== player.facing) {
        return;
      }
      const distance = Math.abs(dx);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = enemy;
      }
    });
    return best;
  }

  function updatePlayerProjectiles(engine, state) {
    for (let i = state.playerProjectiles.length - 1; i >= 0; i -= 1) {
      const projectile = state.playerProjectiles[i];
      projectile.life -= 1;

      if (!projectile.launched) {
        projectile.releaseTimer -= 1;
        if (projectile.releaseTimer <= 0) {
          projectile.launched = true;
          if (projectile.constraint) {
            Composite.remove(engine.world, projectile.constraint);
            projectile.constraint = null;
          }
          Body.setVelocity(projectile.body, {
            x: projectile.targetVx,
            y: projectile.targetVy,
          });
        }
      }

      if (
        projectile.life <= 0 ||
        projectile.body.position.x < -160 ||
        projectile.body.position.x > state.bounds.width + 160 ||
        projectile.body.position.y < -180 ||
        projectile.body.position.y > state.bounds.height + 180
      ) {
        removePlayerProjectile(engine, state, projectile.body);
      }
    }

    state.explosions = state.explosions.filter((explosion) => {
      explosion.timer -= 1;
      return explosion.timer > 0;
    });
  }

  function removePlayerProjectile(engine, state, projectileBody) {
    const index = state.playerProjectiles.findIndex((projectile) => projectile.body === projectileBody);
    if (index === -1) {
      return;
    }

    const projectile = state.playerProjectiles[index];
    Composite.remove(engine.world, projectile.body);
    if (projectile.constraint) {
      Composite.remove(engine.world, projectile.constraint);
    }
    state.playerProjectiles.splice(index, 1);
  }

  function explodeRyanSpecial(engine, state, projectileBody) {
    const projectile = state.playerProjectiles.find((item) => item.body === projectileBody);
    if (!projectile || projectile.kind !== "slingshot") {
      return 0;
    }

    const x = projectile.body.position.x;
    const y = projectile.body.position.y;
    const radius = 96;
    let defeats = 0;

    state.enemies.forEach((enemy) => {
      if (!enemy.alive) {
        return;
      }

      const distance = Math.hypot(enemy.body.position.x - x, enemy.body.position.y - y);
      if (distance <= radius) {
        enemy.alive = false;
        enemy.hitFlash = 16;
        Body.setVelocity(enemy.body, {
          x: Math.sign(enemy.body.position.x - x || 1) * 9,
          y: -8,
        });
        defeats += 1;
      }
    });

    state.explosions.push({
      x,
      y,
      radius,
      timer: 16,
      maxTimer: 16,
    });

    removePlayerProjectile(engine, state, projectileBody);
    return defeats;
  }

  function deflectProjectile(state, projectileBody, pegBody) {
    const projectile = state.projectiles.find((item) => item.body === projectileBody);
    if (!projectile) {
      return;
    }

    const dx = projectileBody.position.x - pegBody.position.x;
    const dy = projectileBody.position.y - pegBody.position.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const speed = Math.max(4.5, Math.hypot(projectile.vx, projectile.vy));
    const nx = dx / length;
    const ny = dy / length;

    projectile.vx = nx * speed;
    projectile.vy = ny * speed;
    projectile.life = Math.max(projectile.life - 4, 1);
    Body.setVelocity(projectile.body, {
      x: projectile.vx,
      y: projectile.vy,
    });
    GameAudio.playBounce(Math.min(1, speed / 8));
  }

  function updateCircuit(state) {
    if (state.mode !== "circuit") {
      return;
    }

    state.doors.forEach((door) => {
      door.timer -= 1;
      if (door.timer > 0) {
        return;
      }

      door.open = !door.open;
      door.body.isSensor = door.open;
      door.timer = door.cycle;
    });
  }

  function applyTeleports(state, player) {
    if (state.mode !== "circuit" || state.teleports.length < 2) {
      return;
    }

    if (state.teleportCooldown > 0) {
      state.teleportCooldown -= 1;
      return;
    }

    for (let i = 0; i < state.teleports.length; i += 1) {
      const teleport = state.teleports[i];
      const dx = player.body.position.x - teleport.body.position.x;
      const dy = player.body.position.y - teleport.body.position.y;
      if (Math.hypot(dx, dy) <= teleport.radius + 12) {
        const destination = state.teleports[teleport.pairIndex];
        if (!destination) {
          return;
        }

        Body.setPosition(player.body, {
          x: destination.body.position.x,
          y: destination.body.position.y - 48,
        });
        Body.setVelocity(player.body, { x: player.body.velocity.x, y: -4 });
        state.teleportCooldown = 36;
        return;
      }
    }
  }

  function captureBoardConfig(state, skin, difficulty) {
    return {
      version: 1,
      mode: state.mode,
      difficulty: difficulty.key,
      skin: skin.key,
      layoutTheme: state.layoutTheme,
      bounds: state.bounds,
      floorConfig: state.floorConfig,
      spawn: state.spawn,
      goal: state.goal,
      solids: state.worldSolids.map(serializeRectBody),
      climbWalls: state.climbWalls.map((wall) => ({
        x: wall.body.position.x,
        y: wall.body.position.y,
        width: wall.width,
        height: wall.height,
      })),
      pegs: state.pegs.map((peg) => ({
        x: peg.body.position.x,
        y: peg.body.position.y,
        radius: peg.radius,
      })),
      bouncers: state.bouncers.map((bouncer) => ({
        x: bouncer.body.position.x,
        y: bouncer.body.position.y,
        width: bouncer.width,
      })),
      scoreSlots: state.scoreSlots.map((slot) => ({
        x: slot.body.position.x,
        y: slot.body.position.y,
        width: slot.width,
        height: slot.height,
        value: slot.value,
        label: slot.label,
      })),
      ramps: state.ramps.map((ramp) => ({
        x: ramp.body.position.x,
        y: ramp.body.position.y,
        width: ramp.width,
        height: ramp.height,
        angle: ramp.angle,
      })),
      doors: state.doors.map((door) => ({
        x: door.body.position.x,
        y: door.body.position.y,
        width: door.width,
        height: door.height,
        cycle: door.cycle,
      })),
      teleports: state.teleports.map((teleport) => ({
        x: teleport.body.position.x,
        y: teleport.body.position.y,
        radius: teleport.radius,
        pairIndex: teleport.pairIndex,
      })),
      hazards: state.hazards.map((hazard) => ({
        x: hazard.x,
        y: hazard.y,
        width: hazard.width,
        height: hazard.height,
        kind: hazard.kind,
      })),
      enemies: state.enemies.map((enemy) => ({
        id: enemy.id,
        x: enemy.body.position.x,
        y: enemy.body.position.y,
        left: enemy.left,
        right: enemy.right,
        speed: enemy.speed,
        direction: enemy.direction,
        shootCooldown: enemy.shootCooldown,
      })),
    };
  }

  function serializeRectBody(body) {
    return {
      x: body.position.x,
      y: body.position.y,
      width: body.bounds.max.x - body.bounds.min.x,
      height: body.bounds.max.y - body.bounds.min.y,
      label: body.label,
      angle: body.angle || 0,
    };
  }

  function exportBoard(state) {
    return state.boardConfig || captureBoardConfig(state, state.skin, state.difficulty);
  }

  function claimScoreSlot(state, playerBody) {
    for (let i = 0; i < state.scoreSlots.length; i += 1) {
      const slot = state.scoreSlots[i];
      if (slot.claimed) {
        continue;
      }

      const insideX = Math.abs(playerBody.position.x - slot.body.position.x) <= slot.width / 2;
      const insideY = Math.abs(playerBody.position.y - slot.body.position.y) <= slot.height / 2;
      if (insideX && insideY) {
        slot.claimed = true;
        return slot;
      }
    }

    return null;
  }

  function importBoard(engine, state, config) {
    clearBodies(engine, state);
    state.mode = config.mode || "standard";
    state.difficulty = getDifficultyConfig(config.difficulty || "medium");
    state.skin = getSkinConfig(config.skin || "neon");
    state.layoutTheme = config.layoutTheme || "imported";
    state.bounds = config.bounds || { width: 3200, height: 1400 };
    state.floorConfig = config.floorConfig || { centerY: 690, height: 320 };
    state.spawn = config.spawn;
    state.goal = config.goal;
    state.worldSolids = (config.solids || []).map((solid) => {
      const body = makeBody(solid.x, solid.y, solid.width, solid.height, { label: solid.label || "solid" });
      if (solid.angle) {
        Body.setAngle(body, solid.angle);
      }
      return body;
    });
    state.climbWalls = (config.climbWalls || []).map((wall) => makeClimbWall(wall.x, wall.y, wall.width, wall.height));
    state.pegs = (config.pegs || []).map((peg) => makePeg(peg.x, peg.y, peg.radius, state.skin));
    state.bouncers = (config.bouncers || []).map((bouncer) => makeBouncer(bouncer.x, bouncer.y, bouncer.width, state.skin));
    state.scoreSlots = (config.scoreSlots || []).map((slot) => makeScoreSlot(slot.x, slot.y, slot.width, slot.height, slot.value, slot.label, state.skin));
    state.ramps = (config.ramps || []).map((ramp) => makeRamp(ramp.x, ramp.y, ramp.width, ramp.height, ramp.angle, state.skin));
    state.doors = (config.doors || []).map((door) => makeDoor(door.x, door.y, door.width, door.height, door.cycle || 180, state.skin));
    state.teleports = (config.teleports || []).map((teleport) => makeTeleport(teleport.x, teleport.y, teleport.radius, teleport.pairIndex, state.skin));
    state.hazards = (config.hazards || []).map((hazard) => makeHazard(hazard.x, hazard.y, hazard.width, hazard.height, hazard.kind));
    state.enemies = (config.enemies || []).map((enemy) => importEnemy(enemy));
    state.projectiles = [];
    state.teleportCooldown = 0;
    Composite.add(engine.world, [
      ...state.worldSolids,
      ...state.climbWalls.map((wall) => wall.body),
      ...state.pegs.map((peg) => peg.body),
      ...state.bouncers.map((bouncer) => bouncer.body),
      ...state.scoreSlots.map((slot) => slot.body),
      ...state.ramps.map((ramp) => ramp.body),
      ...state.doors.map((door) => door.body),
      ...state.teleports.map((teleport) => teleport.body),
      ...state.hazards.map((hazard) => hazard.body),
      ...state.enemies.map((enemy) => enemy.body),
    ]);
    state.boardConfig = config;
    state.skyEvent = {
      cooldown: state.difficulty.skyCooldown,
      warning: null,
      activeProjectile: null,
      gate: null,
    };
    setFloorGap(engine, state, null);
  }

  function importEnemy(enemy) {
    const body = Bodies.rectangle(enemy.x, enemy.y, 38, 66, {
      inertia: Infinity,
      friction: 0.02,
      frictionAir: 0.02,
      restitution: 0,
      label: "enemy",
      render: { visible: false },
    });

    Body.setMass(body, 5);
    return {
      id: enemy.id,
      body,
      width: 38,
      height: 66,
      left: enemy.left,
      right: enemy.right,
      speed: enemy.speed,
      direction: enemy.direction,
      alive: true,
      hitFlash: 0,
      shootCooldown: enemy.shootCooldown,
    };
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
    drawSolids(ctx, camera, state.solids, state.skin);
    drawClimbWalls(ctx, camera, state.climbWalls);
    drawPegs(ctx, camera, state.pegs, state.skin);
    drawBouncers(ctx, camera, state.bouncers, state.skin);
    drawScoreSlots(ctx, camera, state.scoreSlots, state.skin);
    drawRamps(ctx, camera, state.ramps, state.skin);
    drawDoors(ctx, camera, state.doors, state.skin);
    drawTeleports(ctx, camera, state.teleports, state.skin);
    drawHazards(ctx, camera, state.hazards);
    drawEnemies(ctx, camera, state.enemies);
    drawProjectiles(ctx, camera, state.projectiles);
    drawPlayerProjectiles(ctx, camera, state.playerProjectiles);
    drawExplosions(ctx, camera, state.explosions);
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

  function drawSolids(ctx, camera, solids, skin) {
    solids.forEach((solid) => {
      const width = solid.bounds.max.x - solid.bounds.min.x;
      const height = solid.bounds.max.y - solid.bounds.min.y;
      const x = solid.position.x - width / 2 - camera.x;
      const y = solid.position.y - height / 2 - camera.y;

      const isGround = solid.label === "ground";
      ctx.fillStyle = isGround ? skin.groundBase : skin.solidBase;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));

      ctx.fillStyle = isGround ? skin.groundTop : skin.solidTop;
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
      ctx.fillStyle = hazard.kind === "pit" ? "#2e0810" : "#43111b";
      ctx.fillRect(Math.round(x), Math.round(y + 8), Math.round(hazard.width), Math.round(hazard.height - 8));
      ctx.fillStyle = "#ff586d";
      for (let i = 0; i < hazard.width; i += 16) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + hazard.height);
        ctx.lineTo(x + i + 8, y);
        ctx.lineTo(x + i + 16, y + hazard.height);
        ctx.fill();
      }
      if (hazard.kind === "pit") {
        ctx.fillStyle = "rgba(255, 150, 170, 0.18)";
        ctx.fillRect(Math.round(x), Math.round(y + hazard.height + 2), Math.round(hazard.width), 8);
      }
    });
  }

  function drawClimbWalls(ctx, camera, climbWalls) {
    climbWalls.forEach((wall) => {
      const x = wall.body.position.x - wall.width / 2 - camera.x;
      const y = wall.body.position.y - wall.height / 2 - camera.y;
      ctx.fillStyle = "#16253d";
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(wall.width), Math.round(wall.height));
      ctx.fillStyle = "#7ef0ff";
      ctx.fillRect(Math.round(x + 3), Math.round(y + 4), Math.round(wall.width - 6), Math.round(wall.height - 8));
      ctx.fillStyle = "#d5fbff";
      for (let py = 10; py < wall.height - 10; py += 18) {
        ctx.fillRect(Math.round(x + 6), Math.round(y + py), Math.round(wall.width - 12), 3);
      }
    });
  }

  function drawPegs(ctx, camera, pegs, skin) {
    pegs.forEach((peg) => {
      const x = peg.body.position.x - camera.x;
      const y = peg.body.position.y - camera.y;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.fillStyle = skin.pegOuter;
      ctx.beginPath();
      ctx.arc(0, 0, peg.radius + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skin.pegCore;
      ctx.beginPath();
      ctx.arc(0, 0, peg.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skin.pegLight;
      ctx.beginPath();
      ctx.arc(-2, -2, Math.max(3, peg.radius / 3), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawBouncers(ctx, camera, bouncers, skin) {
    bouncers.forEach((bouncer) => {
      const x = bouncer.body.position.x - bouncer.width / 2 - camera.x;
      const y = bouncer.body.position.y - bouncer.height / 2 - camera.y;
      ctx.fillStyle = skin.bouncerBase;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(bouncer.width), Math.round(bouncer.height));
      ctx.fillStyle = skin.bouncerGlow;
      ctx.fillRect(Math.round(x + 4), Math.round(y + 3), Math.round(bouncer.width - 8), 4);
      ctx.fillStyle = skin.bouncerLight;
      for (let i = 8; i < bouncer.width - 8; i += 14) {
        ctx.fillRect(Math.round(x + i), Math.round(y + 9), 6, 3);
      }
    });
  }

  function drawScoreSlots(ctx, camera, scoreSlots, skin) {
    scoreSlots.forEach((slot) => {
      const x = slot.body.position.x - slot.width / 2 - camera.x;
      const y = slot.body.position.y - slot.height / 2 - camera.y;
      ctx.fillStyle = slot.claimed ? "rgba(255,255,255,0.08)" : skin.doorBase;
      ctx.fillRect(Math.round(x), Math.round(y), slot.width, slot.height);
      ctx.fillStyle = slot.claimed ? "rgba(255,255,255,0.18)" : skin.doorGlow;
      ctx.fillRect(Math.round(x + 4), Math.round(y + 4), slot.width - 8, 8);
      ctx.fillStyle = slot.claimed ? "#9fb0c8" : skin.pegLight;
      ctx.font = "14px Courier New";
      ctx.fillText(String(slot.value), Math.round(x + 10), Math.round(y + 34));
      ctx.fillText(slot.label, Math.round(x + 18), Math.round(y + 56));
    });
  }

  function drawRamps(ctx, camera, ramps, skin) {
    ramps.forEach((ramp) => {
      const vertices = ramp.body.vertices;
      ctx.save();
      ctx.fillStyle = skin.rampBase;
      ctx.beginPath();
      ctx.moveTo(vertices[0].x - camera.x, vertices[0].y - camera.y);
      for (let i = 1; i < vertices.length; i += 1) {
        ctx.lineTo(vertices[i].x - camera.x, vertices[i].y - camera.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = skin.bouncerLight;
      ctx.beginPath();
      ctx.moveTo(vertices[0].x - camera.x, vertices[0].y - camera.y);
      ctx.lineTo(vertices[1].x - camera.x, vertices[1].y - camera.y);
      ctx.strokeStyle = skin.bouncerLight;
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.strokeStyle = "rgba(10, 14, 24, 0.45)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(vertices[2].x - camera.x, vertices[2].y - camera.y);
      ctx.lineTo(vertices[3].x - camera.x, vertices[3].y - camera.y);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawDoors(ctx, camera, doors, skin) {
    doors.forEach((door) => {
      const x = door.body.position.x - door.width / 2 - camera.x;
      const y = door.body.position.y - door.height / 2 - camera.y;
      ctx.fillStyle = door.open ? "rgba(126, 240, 255, 0.12)" : skin.doorBase;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(door.width), Math.round(door.height));
      ctx.fillStyle = skin.doorGlow;
      ctx.fillRect(Math.round(x + 4), Math.round(y + 6), Math.round(door.width - 8), Math.round(Math.max(8, door.height - 12)));
    });
  }

  function drawTeleports(ctx, camera, teleports, skin) {
    teleports.forEach((teleport) => {
      const x = teleport.body.position.x - camera.x;
      const y = teleport.body.position.y - camera.y;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.fillStyle = skin.teleportOuter;
      ctx.beginPath();
      ctx.arc(0, 0, teleport.radius + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = skin.teleportGlow;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, teleport.radius + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(4, teleport.radius - 6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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

  function drawPlayerProjectiles(ctx, camera, projectiles) {
    projectiles.forEach((projectile) => {
      const x = projectile.body.position.x - camera.x;
      const y = projectile.body.position.y - camera.y;
      if (projectile.constraint) {
        ctx.strokeStyle = "rgba(214, 169, 75, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(projectile.anchor.x - camera.x, projectile.anchor.y - camera.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      if (projectile.kind === "slingshot") {
        ctx.fillStyle = "#d4a84f";
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffe19d";
        ctx.beginPath();
        ctx.arc(-2, -2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 215, 126, 0.28)";
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.fill();
      } else if (projectile.kind === "shuriken") {
        ctx.rotate(projectile.body.angle);
        ctx.fillStyle = "#92efff";
        for (let i = 0; i < 4; i += 1) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(12, -3);
          ctx.lineTo(5, 0);
          ctx.lineTo(12, 3);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = "#dffcff";
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(146, 239, 255, 0.25)";
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const heavyShot = projectile.kind === "sniperHeavy";
        ctx.fillStyle = heavyShot ? "#ffd98b" : "#efc768";
        ctx.fillRect(-10, -2, heavyShot ? 26 : 20, heavyShot ? 6 : 4);
        ctx.fillStyle = "#fff2c8";
        ctx.fillRect(-4, -1, heavyShot ? 12 : 9, 2);
        ctx.fillStyle = "rgba(255, 219, 126, 0.28)";
        ctx.fillRect(-14, -5, heavyShot ? 34 : 26, heavyShot ? 12 : 10);
        ctx.beginPath();
        ctx.moveTo(heavyShot ? 16 : 10, 0);
        ctx.lineTo(heavyShot ? 8 : 6, heavyShot ? -5 : -4);
        ctx.lineTo(heavyShot ? 8 : 6, heavyShot ? 5 : 4);
        ctx.closePath();
        ctx.fillStyle = "#fff0be";
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawExplosions(ctx, camera, explosions) {
    explosions.forEach((explosion) => {
      const t = explosion.timer / explosion.maxTimer;
      const x = explosion.x - camera.x;
      const y = explosion.y - camera.y;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.fillStyle = `rgba(255, 214, 122, ${0.18 + t * 0.28})`;
      ctx.beginPath();
      ctx.arc(0, 0, explosion.radius * (1 - t * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 240, 188, ${0.4 + t * 0.4})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, explosion.radius * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(214, 214, 214, ${0.12 + t * 0.16})`;
      ctx.beginPath();
      ctx.arc(-18, -8, 18, 0, Math.PI * 2);
      ctx.arc(20, 2, 14, 0, Math.PI * 2);
      ctx.arc(0, 18, 16, 0, Math.PI * 2);
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
    getDifficultyConfig,
    getSkinConfig,
    updateEnemies,
    updateCombat,
    updatePlayerProjectiles,
    updateCircuit,
    updateSkyEvent,
    applyTeleports,
    removeProjectile,
    removePlayerProjectile,
    spawnRoninShuriken,
    spawnRyanBullet,
    spawnRyanSpecial,
    explodeRyanSpecial,
    deflectProjectile,
    spawnMeteorShower,
    finishSkyStrike,
    claimScoreSlot,
    exportBoard,
    importBoard,
    renderWorld,
  };
}());
