(function () {
  const {
    Bodies,
    Body,
    Composite,
  } = Matter;

  function getBodyPositionFromSpawn(player, spawn) {
    return {
      x: spawn.x,
      y: spawn.y - (player.height / 2),
    };
  }

  function createPlayer(engine, spawn) {
    const width = 34;
    const height = 70;
    const body = Bodies.rectangle(spawn.x, spawn.y - (height / 2), width, height, {
      friction: 0.001,
      frictionAir: 0.02,
      restitution: 0,
      inertia: Infinity,
      label: "player",
      render: { visible: false },
    });

    Body.setMass(body, 7);
    Composite.add(engine.world, body);

    return {
      engine,
      body,
      width,
      height,
      facing: 1,
      character: "ronin",
      characterName: "Kage Ryu",
      onGround: false,
      wallSide: 0,
      spawn: { x: spawn.x, y: spawn.y },
      lives: 3,
      score: 0,
      highScore: 0,
      invulnerableTimer: 0,
      attackCooldown: 0,
      heavyCooldown: 0,
      dashCooldown: 0,
      dashTimer: 0,
      evadeCooldown: 0,
      evadeTimer: 0,
      specialCooldown: 0,
      actionLock: 0,
      animationTime: 0,
      jumpBuffer: 0,
      coyoteTimer: 0,
      extraJumps: 1,
      hitPause: 0,
      attackHitIds: new Set(),
      slashArc: 0,
      slashArcMode: "arc",
      specialWave: null,
      muzzleFlash: 0,
      sniperAimFlash: 0,
      smashImpactDone: false,
      effects: [],
      state: "idle",
      stateFrame: 0,
      animFrame: 0,
      activeAttack: null,
      lastSafeX: spawn.x,
      lastSafeY: spawn.y,
    };
  }

  const ANIMATIONS = {
    idle: { frames: 4, speed: 16 },
    crouch: { frames: 3, speed: 12 },
    run: { frames: 5, speed: 6 },
    jump: { frames: 4, speed: 8 },
    wallslide: { frames: 3, speed: 8 },
    slash: { frames: 4, speed: 4 },
    heavy: { frames: 5, speed: 5 },
    dash: { frames: 4, speed: 3 },
    evade: { frames: 4, speed: 3 },
    hurt: { frames: 3, speed: 6 },
  };

  function updatePlayer(player, input, worldState) {
    if (player.hitPause > 0) {
      player.hitPause -= 1;
      tickTimers(player);
      return;
    }

    const vel = player.body.velocity;
    const moveDir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    const wallInfo = detectWallContact(player, worldState, moveDir);
    player.wallSide = wallInfo.side;
    if (wallInfo.canSlide && !player.activeAttack) {
      player.facing = wallInfo.side;
    }
    const isCrouching = input.down && player.onGround && !player.activeAttack && player.dashTimer <= 0 && player.evadeTimer <= 0;
    const preserveAirMomentum = player.activeAttack && player.activeAttack.airborne;
    const maxSpeed = player.dashTimer > 0 ? 10.5 : 4.7;
    const accel = isCrouching ? 0.38 : player.onGround ? 0.75 : 0.42;
    const decel = player.onGround ? 0.72 : 0.92;

    if (moveDir !== 0 && (player.actionLock <= 0 || preserveAirMomentum) && player.evadeTimer <= 0) {
      Body.setVelocity(player.body, {
        x: vel.x + moveDir * accel,
        y: vel.y,
      });
      player.facing = moveDir;
    } else if (player.dashTimer <= 0 && player.evadeTimer <= 0 && !preserveAirMomentum) {
      Body.setVelocity(player.body, {
        x: vel.x * decel,
        y: vel.y,
      });
    }

    if (Math.abs(player.body.velocity.x) > maxSpeed) {
      Body.setVelocity(player.body, {
        x: maxSpeed * Math.sign(player.body.velocity.x),
        y: player.body.velocity.y,
      });
    }

    if (input.jumpPressed) {
      player.jumpBuffer = 10;
    }

    if (input.jumpPressed && wallInfo.canSlide && !player.onGround && player.actionLock <= 0) {
      Body.setVelocity(player.body, {
        x: -wallInfo.side * 8.6,
        y: -11.2,
      });
      player.facing = -wallInfo.side;
      player.onGround = false;
      player.coyoteTimer = 0;
      player.jumpBuffer = 0;
      player.extraJumps = 1;
      pushEffect(player, "jump", player.body.position.x, player.body.position.y + 20, player.facing);
    }

    if (player.jumpBuffer > 0 && (player.onGround || player.coyoteTimer > 0) && player.actionLock <= 0 && !isCrouching) {
      Body.setVelocity(player.body, {
        x: player.body.velocity.x,
        y: -11.2,
      });
      player.onGround = false;
      player.coyoteTimer = 0;
      player.jumpBuffer = 0;
      pushEffect(player, "jump", player.body.position.x, player.body.position.y + 20, player.facing);
    } else if (input.jumpPressed && !player.onGround && player.extraJumps > 0 && player.actionLock <= 0) {
      Body.setVelocity(player.body, {
        x: player.body.velocity.x,
        y: -10.6,
      });
      player.extraJumps -= 1;
      player.jumpBuffer = 0;
      pushEffect(player, "doubleJump", player.body.position.x, player.body.position.y + 14, player.facing);
    }

    if (wallInfo.canSlide && player.body.velocity.y > 2.4) {
      Body.setVelocity(player.body, {
        x: player.body.velocity.x,
        y: 2.4,
      });
    }

    if (player.character === "sniper") {
      handleSniperActions(player, input, worldState, wallInfo);
    } else {
      if (input.attackPressed && player.attackCooldown <= 0 && (player.actionLock <= 0 || wallInfo.canSlide)) {
        startAttack(player, "slash", 16, 18, 70, 52, 1);
      }

      if (input.heavyPressed && player.heavyCooldown <= 0 && (player.actionLock <= 0 || wallInfo.canSlide)) {
        throwShuriken(player, worldState);
      }
    }

    if (input.dashPressed && player.dashCooldown <= 0) {
      const dashDirection = moveDir !== 0 ? moveDir : player.facing;
      const dashPower = isCrouching ? 14.2 : 12.5;
      player.dashTimer = 10;
      player.dashCooldown = 46;
      player.actionLock = Math.max(player.actionLock, isCrouching ? 10 : 8);
      player.facing = dashDirection;
      Body.setVelocity(player.body, {
        x: dashDirection * dashPower,
        y: Math.min(player.body.velocity.y, 1),
      });
      pushEffect(player, isCrouching ? "slideDash" : "dash", player.body.position.x, player.body.position.y, player.facing);
    }

    if (input.evadePressed && player.evadeCooldown <= 0 && player.actionLock <= 0) {
      const evadeDirection = moveDir !== 0 ? moveDir : player.facing;
      player.evadeTimer = 12;
      player.evadeCooldown = 54;
      player.actionLock = Math.max(player.actionLock, 10);
      player.facing = evadeDirection;
      player.activeAttack = null;
      Body.setVelocity(player.body, {
        x: evadeDirection * 11.5,
        y: Math.min(player.body.velocity.y, 0),
      });
      pushEffect(player, "evade", player.body.position.x, player.body.position.y, player.facing);
    }

    if (input.specialPressed && player.specialCooldown <= 0 && !player.specialWave) {
      if (player.character === "sniper") {
        fireSniperLock(player, worldState);
      } else {
        startSpecialWave(player);
      }
    }

    updateAttack(player, worldState);
    updateSpecialWave(player, worldState);
    updateEffects(player);
    updateSafePoint(player);
    updateAnimation(player, moveDir, isCrouching, wallInfo.canSlide);
    tickTimers(player);
  }

  function handleSniperActions(player, input, worldState, wallInfo) {
    if (input.attackPressed && player.attackCooldown <= 0 && (player.actionLock <= 0 || wallInfo.canSlide)) {
      fireSniperShot(player, worldState, false);
    }

    if (input.heavyPressed && player.heavyCooldown <= 0 && (player.actionLock <= 0 || wallInfo.canSlide)) {
      if (!player.onGround) {
        startSmashAttack(player);
      } else {
        fireSniperShot(player, worldState, true);
      }
    }
  }

  function fireSniperShot(player, worldState, charged) {
    player.attackCooldown = charged ? player.attackCooldown : 14;
    player.heavyCooldown = charged ? 26 : player.heavyCooldown;
    player.actionLock = charged ? 10 : 6;
    player.activeAttack = {
      type: charged ? "heavy" : "slash",
      source: "projectile",
      timer: charged ? 12 : 8,
      rangeX: charged ? 720 : 540,
      rangeY: charged ? 90 : 66,
      damage: charged ? 3 : 1,
      airborne: false,
      radius: 0,
    };
    player.attackHitIds.clear();
    player.slashArc = charged ? 8 : 6;
    player.slashArcMode = "shot";
    player.muzzleFlash = charged ? 10 : 7;
    GameAudio.playSword(charged ? "heavy" : "slash");
    GameWorld.spawnRyanBullet(player.engine, worldState, player, charged);
    pushEffect(player, charged ? "sniperHeavy" : "sniperShot", player.body.position.x + player.facing * 24, player.body.position.y - 10, player.facing);
  }

  function throwShuriken(player, worldState) {
    player.heavyCooldown = 20;
    player.actionLock = 8;
    player.activeAttack = {
      type: "heavy",
      source: "projectile",
      timer: 10,
      rangeX: 0,
      rangeY: 0,
      damage: 2,
      airborne: false,
      radius: 0,
    };
    player.attackHitIds.clear();
    player.slashArc = 8;
    player.slashArcMode = "shot";
    GameAudio.playSword("heavy");
    GameWorld.spawnRoninShuriken(player.engine, worldState, player);
    pushEffect(player, "shuriken", player.body.position.x + player.facing * 18, player.body.position.y - 8, player.facing);
  }

  function startSmashAttack(player) {
    player.heavyCooldown = 26;
    player.actionLock = 10;
    player.smashImpactDone = false;
    player.activeAttack = {
      type: "smash",
      timer: 24,
      rangeX: 54,
      rangeY: 64,
      damage: 4,
      airborne: true,
      radius: 58,
    };
    player.attackHitIds.clear();
    player.slashArc = 10;
    player.slashArcMode = "smash";
    Body.setVelocity(player.body, {
      x: player.body.velocity.x * 0.6,
      y: 14,
    });
    pushEffect(player, "smashPrep", player.body.position.x, player.body.position.y, player.facing);
  }

  function fireSniperLock(player, worldState) {
    player.specialCooldown = 240;
    player.sniperAimFlash = 18;
    GameWorld.spawnRyanSpecial(player.engine, worldState, player);
    pushEffect(player, "sniperAim", player.body.position.x + player.facing * 28, player.body.position.y - 12, player.facing);
  }

  function detectWallContact(player, worldState, moveDir) {
    if (player.onGround || player.body.velocity.y < 0) {
      return { canSlide: false, side: 0 };
    }

    for (const wall of worldState.climbWalls) {
      const dx = wall.body.position.x - player.body.position.x;
      const dy = Math.abs(wall.body.position.y - player.body.position.y);
      const horizontalReach = (wall.width / 2) + (player.width / 2) + 6;
      const verticalReach = (wall.height / 2) + (player.height / 2) - 8;
      if (Math.abs(dx) <= horizontalReach && dy <= verticalReach) {
        const side = dx > 0 ? 1 : -1;
        const pressingTowardWall = moveDir === side || moveDir === 0;
        if (pressingTowardWall) {
          return { canSlide: true, side };
        }
      }
    }

    return { canSlide: false, side: 0 };
  }

  function tickTimers(player) {
    if (player.attackCooldown > 0) player.attackCooldown -= 1;
    if (player.heavyCooldown > 0) player.heavyCooldown -= 1;
    if (player.dashCooldown > 0) player.dashCooldown -= 1;
    if (player.dashTimer > 0) player.dashTimer -= 1;
    if (player.evadeCooldown > 0) player.evadeCooldown -= 1;
    if (player.evadeTimer > 0) player.evadeTimer -= 1;
    if (player.specialCooldown > 0) player.specialCooldown -= 1;
    if (player.actionLock > 0) player.actionLock -= 1;
    if (player.invulnerableTimer > 0) player.invulnerableTimer -= 1;
    if (player.jumpBuffer > 0) player.jumpBuffer -= 1;
    if (!player.onGround && player.coyoteTimer > 0) player.coyoteTimer -= 1;
  }

  function startAttack(player, type, cooldown, lock, rangeX, rangeY, damage) {
    const airborne = !player.onGround;
    player.attackCooldown = type === "slash" ? cooldown : player.attackCooldown;
    player.heavyCooldown = type === "heavy" ? cooldown : player.heavyCooldown;
    player.actionLock = airborne ? 0 : lock;
    player.activeAttack = {
      type,
      timer: type === "slash" ? 12 : 16,
      rangeX,
      rangeY,
      damage,
      airborne,
      radius: airborne ? (type === "heavy" ? 110 : 92) : 0,
    };
    player.attackHitIds.clear();
    player.slashArc = type === "slash" ? 12 : 16;
    player.slashArcMode = airborne ? "circle" : "arc";
    GameAudio.playSword(type);
    pushEffect(player, type, player.body.position.x + player.facing * 28, player.body.position.y - 6, player.facing);
  }

  function updateAttack(player, worldState) {
    if (!player.activeAttack) {
      return;
    }

    if (player.activeAttack.source === "projectile") {
      player.activeAttack.timer -= 1;
      if (player.slashArc > 0) {
        player.slashArc -= 1;
      }
      if (player.activeAttack.timer <= 0) {
        player.activeAttack = null;
      }
      return;
    }

    if (player.activeAttack.type === "smash") {
      updateSmashAttack(player, worldState);
      return;
    }

    player.activeAttack.timer -= 1;
    if (player.slashArc > 0) {
      player.slashArc -= 1;
    }

    if (player.activeAttack.timer <= 0) {
      player.activeAttack = null;
      return;
    }

    if (player.activeAttack.timer > 9 && player.activeAttack.type === "slash") {
      return;
    }

    worldState.enemies.forEach((enemy) => {
      if (!enemy.alive || player.attackHitIds.has(enemy.id)) {
        return;
      }

      const dx = enemy.body.position.x - player.body.position.x;
      const dy = enemy.body.position.y - player.body.position.y;
      let inRange = false;

      if (player.activeAttack.airborne) {
        inRange = Math.hypot(dx, dy) < player.activeAttack.radius;
      } else {
        const inFront = Math.sign(dx) === player.facing || Math.abs(dx) < 18;
        inRange = inFront && Math.abs(dx) < player.activeAttack.rangeX && Math.abs(dy) < player.activeAttack.rangeY;
      }

      if (inRange) {
        player.attackHitIds.add(enemy.id);
        enemy.alive = false;
        enemy.hitFlash = 10;
        player.score += getModeScore(worldState, player.activeAttack.type === "heavy" ? 150 : 100);
        player.highScore = Math.max(player.highScore, player.score);
        Body.setVelocity(enemy.body, {
          x: player.facing * 8,
          y: -5,
        });
        pushEffect(player, "hit", enemy.body.position.x, enemy.body.position.y - 10, player.facing);
      }
    });
  }

  function updateSmashAttack(player, worldState) {
    player.activeAttack.timer -= 1;
    player.slashArc = Math.max(0, player.slashArc - 1);

    if (player.body.velocity.y < 12) {
      Body.setVelocity(player.body, {
        x: player.body.velocity.x,
        y: 12,
      });
    }

    worldState.enemies.forEach((enemy) => {
      if (!enemy.alive || player.attackHitIds.has(enemy.id)) {
        return;
      }

      const dx = enemy.body.position.x - player.body.position.x;
      const dy = enemy.body.position.y - (player.body.position.y + 18);
      if (Math.hypot(dx, dy) <= player.activeAttack.radius) {
        player.attackHitIds.add(enemy.id);
        enemy.alive = false;
        enemy.hitFlash = 14;
        player.score += getModeScore(worldState, 220);
        player.highScore = Math.max(player.highScore, player.score);
        Body.setVelocity(enemy.body, { x: Math.sign(dx || 1) * 7, y: -8 });
        pushEffect(player, "smoke", enemy.body.position.x, enemy.body.position.y + 20, player.facing);
      }
    });

    if (player.onGround && !player.smashImpactDone) {
      player.smashImpactDone = true;
      player.actionLock = 8;
      pushEffect(player, "smoke", player.body.position.x, player.body.position.y + 28, player.facing);
      player.activeAttack = null;
      return;
    }

    if (player.activeAttack.timer <= 0) {
      player.activeAttack = null;
    }
  }

  function startSpecialWave(player) {
    player.specialCooldown = 300;
    player.specialWave = {
      x: player.body.position.x,
      y: player.body.position.y,
      radius: 24,
      maxRadius: 1200,
      speed: 28,
      hitIds: new Set(),
      timer: 44,
    };
    player.actionLock = Math.max(player.actionLock, 12);
    GameAudio.playSpecialWave();
    pushEffect(player, "specialPulse", player.body.position.x, player.body.position.y, player.facing);
  }

  function updateSpecialWave(player, worldState) {
    if (!player.specialWave) {
      return;
    }

    const wave = player.specialWave;
    wave.timer -= 1;
    wave.radius += wave.speed;

    worldState.enemies.forEach((enemy) => {
      if (!enemy.alive || wave.hitIds.has(enemy.id)) {
        return;
      }

      const distance = Math.hypot(
        enemy.body.position.x - wave.x,
        enemy.body.position.y - wave.y
      );

      if (distance <= wave.radius) {
        wave.hitIds.add(enemy.id);
        enemy.alive = false;
        enemy.hitFlash = 12;
        player.score += getModeScore(worldState, 200);
        player.highScore = Math.max(player.highScore, player.score);
        Body.setVelocity(enemy.body, {
          x: Math.sign(enemy.body.position.x - wave.x || 1) * 10,
          y: -7,
        });
      }
    });

    if (wave.radius >= wave.maxRadius || wave.timer <= 0) {
      player.specialWave = null;
    }
  }

  function updateSafePoint(player) {
    if (player.onGround) {
      player.lastSafeX = player.body.position.x;
      player.lastSafeY = player.body.position.y + (player.height / 2);
    }
  }

  function getModeScore(worldState, baseScore) {
    if (worldState.mode === "circuit") {
      return Math.max(10, Math.round(baseScore * 0.2));
    }

    return baseScore;
  }

  function updateAnimation(player, moveDir, isCrouching, isWallSliding) {
    let nextState = "idle";

    if (player.invulnerableTimer > 0 && player.hitPause > 0) {
      nextState = "hurt";
    } else if (player.evadeTimer > 0) {
      nextState = "evade";
    } else if (player.dashTimer > 0) {
      nextState = "dash";
    } else if (player.activeAttack && (player.activeAttack.type === "heavy" || player.activeAttack.type === "smash")) {
      nextState = "heavy";
    } else if (player.activeAttack) {
      nextState = "slash";
    } else if (isWallSliding) {
      nextState = "wallslide";
    } else if (isCrouching) {
      nextState = "crouch";
    } else if (!player.onGround) {
      nextState = "jump";
    } else if (moveDir !== 0 || Math.abs(player.body.velocity.x) > 1.2) {
      nextState = "run";
    }

    if (player.state !== nextState) {
      player.state = nextState;
      player.stateFrame = 0;
      player.animationTime = 0;
    }

    player.animationTime += 1;
    const anim = ANIMATIONS[player.state];
    player.animFrame = Math.floor(player.animationTime / anim.speed) % anim.frames;
    player.stateFrame = player.animFrame;
  }

  function updateEffects(player) {
    player.effects = player.effects.filter((effect) => {
      effect.timer -= 1;
      return effect.timer > 0;
    });
    if (player.muzzleFlash > 0) player.muzzleFlash -= 1;
    if (player.sniperAimFlash > 0) player.sniperAimFlash -= 1;
  }

  function pushEffect(player, type, x, y, facing) {
    player.effects.push({
      type,
      x,
      y,
      facing,
      timer: type === "hit" ? 8 : 12,
      maxTimer: type === "hit" ? 8 : 12,
    });
  }

  function setGrounded(player, grounded) {
    if (grounded) {
      if (!player.onGround) {
        player.coyoteTimer = 6;
      }
      player.extraJumps = 1;
      player.onGround = true;
      if (player.activeAttack && player.activeAttack.type === "smash" && !player.smashImpactDone) {
        player.smashImpactDone = true;
        pushEffect(player, "smoke", player.body.position.x, player.body.position.y + 28, player.facing);
        player.activeAttack = null;
      }
    } else {
      if (player.onGround) {
        player.coyoteTimer = 6;
      }
      player.onGround = false;
    }
  }

  function hurtPlayer(player) {
    if (player.invulnerableTimer > 0 || player.evadeTimer > 0) {
      return false;
    }

    player.lives -= 1;
    player.invulnerableTimer = 90;
    player.hitPause = 8;
    player.activeAttack = null;
    player.dashTimer = 0;
    player.evadeTimer = 0;
    return true;
  }

  function respawnPlayer(player) {
    const x = player.lastSafeX || player.spawn.x;
    const y = player.lastSafeY || player.spawn.y;
    Body.setPosition(player.body, {
      x,
      y: y - (player.height / 2) - 2,
    });
    Body.setVelocity(player.body, { x: 0, y: 0 });
    player.invulnerableTimer = 70;
    player.activeAttack = null;
    player.evadeTimer = 0;
    player.specialWave = null;
    player.smashImpactDone = false;
    player.extraJumps = 1;
    player.effects.length = 0;
  }

  function resetPlayer(player) {
    player.lives = 3;
    player.score = 0;
    player.lastSafeX = player.spawn.x;
    player.lastSafeY = player.spawn.y;
    Body.setPosition(player.body, getBodyPositionFromSpawn(player, player.spawn));
    Body.setVelocity(player.body, { x: 0, y: 0 });
    player.invulnerableTimer = 0;
    player.activeAttack = null;
    player.evadeTimer = 0;
    player.specialWave = null;
    player.smashImpactDone = false;
    player.muzzleFlash = 0;
    player.sniperAimFlash = 0;
    player.extraJumps = 1;
    player.effects.length = 0;
  }

  function setSpawn(player, spawn) {
    player.spawn.x = spawn.x;
    player.spawn.y = spawn.y;
    player.lastSafeX = spawn.x;
    player.lastSafeY = spawn.y;
    player.extraJumps = 1;
    player.evadeTimer = 0;
    player.specialWave = null;
    player.smashImpactDone = false;
    Body.setPosition(player.body, getBodyPositionFromSpawn(player, spawn));
    Body.setVelocity(player.body, { x: 0, y: 0 });
  }

  function setCharacter(player, characterKey) {
    player.character = characterKey === "sniper" ? "sniper" : "ronin";
    player.characterName = player.character === "sniper" ? "Ryan Target" : "Kage Ryu";
    player.activeAttack = null;
    player.specialWave = null;
    player.smashImpactDone = false;
    player.muzzleFlash = 0;
    player.sniperAimFlash = 0;
    player.effects.length = 0;
  }

  function renderPlayer(ctx, camera, player) {
    const px = Math.round(player.body.position.x - camera.x);
    const py = Math.round(player.body.position.y - camera.y);
    const frame = player.animFrame;
    const bob = player.state === "run" ? (frame % 2 === 0 ? -1 : 1) : 0;
    const jumpRotation = player.state === "jump" ? getJumpRotation(player) : 0;
    const dashRotation = player.state === "dash" ? getDashRotation(player) : 0;

    ctx.save();
    ctx.translate(px, py + bob);
    if (player.state === "dash" && player.facing > 0) {
      ctx.scale(-1, 1);
    } else {
      ctx.scale(player.facing, 1);
    }
    if (jumpRotation !== 0) {
      ctx.rotate(jumpRotation);
    } else if (dashRotation !== 0) {
      ctx.rotate(dashRotation);
    }

    const blink = player.invulnerableTimer > 0 && Math.floor(player.invulnerableTimer / 6) % 2 === 0;
    if (!blink) {
      if (player.character === "sniper") {
        drawSniperFrame(ctx, player.state, frame, player);
      } else {
        drawRoninFrame(ctx, player.state, frame);
      }
    }

    if (player.activeAttack || player.slashArc > 0) {
      drawSlashTrail(ctx, player);
    }

    ctx.restore();

    if (player.specialWave) {
      drawSpecialWave(ctx, camera, player.specialWave);
    }

    renderEffects(ctx, camera, player.effects);
  }

  function drawSpecialWave(ctx, camera, wave) {
    const x = wave.x - camera.x;
    const y = wave.y - camera.y;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.strokeStyle = "rgba(165, 244, 255, 0.88)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, wave.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(70, 185, 255, 0.38)";
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(0, 0, wave.radius + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function getJumpRotation(player) {
    const rotationFrames = [0.2, 1.45, 2.75, 3.65];
    return rotationFrames[player.animFrame % rotationFrames.length] * player.facing;
  }

  function getDashRotation(player) {
    const dashFrames = [-0.22, -0.3, -0.26, -0.18];
    return dashFrames[player.animFrame % dashFrames.length] * player.facing;
  }

  function drawRoninFrame(ctx, state, frame) {
    const poses = getPose(state, frame);

    ctx.fillStyle = "#100f1a";
    ctx.fillRect(-10, 26, 10, 8);
    ctx.fillRect(4, 26, 10, 8);

    ctx.fillStyle = "#203a67";
    ctx.fillRect(-13, -12 + poses.torsoY, 26, 28);

    ctx.fillStyle = "#2d5a9e";
    ctx.fillRect(-11, -10 + poses.torsoY, 22, 24);

    ctx.fillStyle = "#6ea2d9";
    ctx.fillRect(-10, -8 + poses.torsoY, 6, 8);
    ctx.fillRect(4, -8 + poses.torsoY, 6, 8);

    ctx.fillStyle = "#f5a34f";
    ctx.fillRect(-8, -28 + poses.headY, 18, 10);

    ctx.fillStyle = "#2a1310";
    ctx.fillRect(-11, -33 + poses.headY, 22, 8);
    ctx.fillRect(-6, -38 + poses.headY, 12, 6);
    ctx.fillRect(5, -35 + poses.headY, 8, 5);

    ctx.fillStyle = "#a84dff";
    ctx.fillRect(-8, -22 + poses.headY, 16, 7);

    ctx.fillStyle = "#071120";
    ctx.fillRect(-6, -20 + poses.headY, 12, 3);

    ctx.fillStyle = "#d12c43";
    ctx.fillRect(-18, -16 + poses.scarfY, 18 + poses.scarfTail, 7);
    ctx.fillRect(-24 - poses.scarfTrail, -14 + poses.scarfY, 12, 5);
    ctx.fillRect(-34 - poses.scarfTrail, -12 + poses.scarfY, 10, 4);

    ctx.fillStyle = "#16274a";
    ctx.fillRect(-18, -8 + poses.armY, 8, 18);
    ctx.fillRect(10, -8 + poses.armY2, 8, 18);

    ctx.fillStyle = "#0f1930";
    ctx.fillRect(-11 + poses.legFrontX, 14, 9, 18 + poses.legFrontY);
    ctx.fillRect(3 + poses.legBackX, 14, 9, 18 + poses.legBackY);

    ctx.fillStyle = "#d5dde9";
    ctx.fillRect(-12 + poses.legFrontX, 31 + poses.legFrontY, 10, 4);
    ctx.fillRect(2 + poses.legBackX, 31 + poses.legBackY, 10, 4);

    ctx.fillStyle = "#69d8ff";
    ctx.fillRect(poses.swordX, poses.swordY, poses.swordW, 5);

    ctx.fillStyle = "#b3f1ff";
    ctx.fillRect(poses.swordX + 2, poses.swordY + 1, poses.swordW - 8, 2);

    ctx.fillStyle = "#0e131f";
    ctx.fillRect(poses.swordX - 6, poses.swordY - 1, 7, 7);
  }

  function drawSniperFrame(ctx, state, frame, player) {
    const poses = getSniperPose(state, frame);

    ctx.fillStyle = "#090b10";
    ctx.fillRect(-10, 26, 10, 8);
    ctx.fillRect(4, 26, 10, 8);

    ctx.fillStyle = "#11161f";
    ctx.fillRect(-13, -12 + poses.torsoY, 26, 28);
    ctx.fillStyle = "#1b2430";
    ctx.fillRect(-11, -10 + poses.torsoY, 22, 24);
    ctx.fillStyle = "#2b3442";
    ctx.fillRect(-10, -8 + poses.torsoY, 6, 8);
    ctx.fillRect(4, -8 + poses.torsoY, 6, 8);

    ctx.fillStyle = "#e3c07f";
    ctx.fillRect(-8, -28 + poses.headY, 18, 10);
    ctx.fillStyle = "#0f131a";
    ctx.fillRect(-11, -34 + poses.headY, 22, 11);
    ctx.fillRect(-8, -39 + poses.headY, 16, 6);
    ctx.fillStyle = "#303a47";
    ctx.fillRect(-10, -22 + poses.headY, 20, 4);
    ctx.fillStyle = "#8b2a2a";
    ctx.fillRect(4, -24 + poses.headY, 6, 3);

    const rearShoulder = {
      x: -7 + (poses.rearShoulderX || 0),
      y: -3 + (poses.rearShoulderY || 0),
    };
    const frontShoulder = {
      x: 8 + (poses.frontShoulderX || 0),
      y: -2 + (poses.frontShoulderY || 0),
    };
    const rearElbow = {
      x: rearShoulder.x + 8,
      y: rearShoulder.y + 4 + poses.armY * 0.6,
    };
    const frontElbow = {
      x: frontShoulder.x + 10,
      y: frontShoulder.y + 4 + poses.armY2 * 0.5,
    };
    const rearHand = {
      x: (poses.gunX || poses.swordX) - 3,
      y: (poses.gunY || poses.swordY) + 2,
    };
    const frontHand = {
      x: (poses.gunX || poses.swordX) + Math.max(14, (poses.gunW || poses.swordW) * 0.45),
      y: (poses.gunY || poses.swordY) + 3,
    };

    drawSniperArm(ctx, rearShoulder, rearElbow, rearHand, "#171d27");
    drawSniperArm(ctx, frontShoulder, frontElbow, frontHand, "#171d27");

    ctx.fillStyle = "#090d14";
    ctx.fillRect(-11 + poses.legFrontX, 14, 9, 18 + poses.legFrontY);
    ctx.fillRect(3 + poses.legBackX, 14, 9, 18 + poses.legBackY);

    drawSniperWeapon(ctx, poses);

    if (player.muzzleFlash > 0) {
      drawSniperMuzzleFlash(ctx, poses);
    }
  }

  function drawSniperArm(ctx, shoulder, elbow, hand, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();
  }

  function drawSniperWeapon(ctx, poses) {
    const gunX = poses.gunX || poses.swordX;
    const gunY = poses.gunY || poses.swordY;
    const gunW = poses.gunW || poses.swordW;
    const gunAngle = poses.gunAngle || 0;
    const recoil = poses.gunKick || 0;

    ctx.save();
    ctx.translate(gunX - recoil, gunY);
    ctx.rotate(gunAngle);

    ctx.fillStyle = "#4a3617";
    ctx.fillRect(-12, -3, 12, 10);

    ctx.fillStyle = "#d4a84f";
    ctx.fillRect(0, -2, gunW, 6);
    ctx.fillRect(gunW - 4, -3, 12, 8);

    ctx.fillStyle = "#ffe2a0";
    ctx.fillRect(6, -1, Math.max(10, gunW - 10), 2);

    ctx.fillStyle = "#b78a2f";
    ctx.fillRect(6, -7, 12, 4);
    ctx.fillRect(20, -7, 10, 3);

    ctx.fillStyle = "#2d2110";
    ctx.fillRect(2, 4, 6, 7);

    ctx.restore();
  }

  function drawSniperMuzzleFlash(ctx, poses) {
    const gunX = poses.gunX || poses.swordX;
    const gunY = poses.gunY || poses.swordY;
    const gunW = poses.gunW || poses.swordW;
    const gunAngle = poses.gunAngle || 0;

    ctx.save();
    ctx.translate(gunX + gunW + 6, gunY + 1);
    ctx.rotate(gunAngle);
    ctx.fillStyle = "rgba(255, 228, 140, 0.92)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(14, -4);
    ctx.lineTo(22, 0);
    ctx.lineTo(14, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 244, 198, 0.88)";
    ctx.beginPath();
    ctx.arc(2, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function getSniperPose(state, frame) {
    const base = getPose(state, frame);
    const tables = {
      idle: [
        { gunX: 2, gunY: 4, gunW: 30, gunAngle: -0.05, armY: 0, armY2: -3, rearShoulderY: 1, frontShoulderY: -1 },
        { torsoY: -1, headY: -1, gunX: 2, gunY: 3, gunW: 30, gunAngle: -0.08, armY: -1, armY2: -4, rearShoulderY: 0, frontShoulderY: -2 },
        { gunX: 3, gunY: 4, gunW: 31, gunAngle: -0.03, armY: 0, armY2: -3, rearShoulderY: 1, frontShoulderY: -1 },
        { torsoY: 1, headY: 1, gunX: 2, gunY: 5, gunW: 30, gunAngle: -0.02, armY: 1, armY2: -2, rearShoulderY: 2, frontShoulderY: 0 },
      ],
      run: [
        { legFrontX: -4, legFrontY: 3, legBackX: 3, legBackY: -2, armY: 2, armY2: -3, gunX: 1, gunY: 6, gunW: 30, gunAngle: -0.08 },
        { torsoY: -2, headY: -1, armY: 0, armY2: -5, gunX: 2, gunY: 4, gunW: 31, gunAngle: -0.12 },
        { legFrontX: 3, legFrontY: -2, legBackX: -3, legBackY: 3, armY: -1, armY2: -3, gunX: 5, gunY: 5, gunW: 31, gunAngle: -0.06 },
        { torsoY: -1, armY: 1, armY2: -4, gunX: 3, gunY: 6, gunW: 30, gunAngle: -0.08 },
        { torsoY: 1, headY: 1, armY: 2, armY2: -2, gunX: 2, gunY: 7, gunW: 29, gunAngle: -0.05 },
      ],
      jump: [
        { torsoY: -3, headY: -2, armY: 1, armY2: -6, legFrontX: 3, legFrontY: -5, legBackX: -4, legBackY: -3, gunX: -1, gunY: 0, gunW: 28, gunAngle: -0.26 },
        { torsoY: -6, headY: -4, armY: -1, armY2: -10, legFrontX: 6, legFrontY: -10, legBackX: -6, legBackY: -9, gunX: -5, gunY: -5, gunW: 26, gunAngle: -0.4 },
        { torsoY: -5, headY: -3, armY: 2, armY2: -8, legFrontX: -5, legFrontY: -9, legBackX: 5, legBackY: -10, gunX: 7, gunY: -3, gunW: 26, gunAngle: -0.18 },
        { torsoY: -1, headY: -1, armY: 1, armY2: -3, legFrontX: -2, legFrontY: -2, legBackX: 2, legBackY: -1, gunX: 5, gunY: 3, gunW: 30, gunAngle: -0.12 },
      ],
      slash: [
        { torsoY: 1, headY: 0, armY: 6, armY2: -2, legFrontX: -3, legFrontY: 1, legBackX: 1, legBackY: 0, gunX: -12, gunY: 8, gunW: 34, gunAngle: 0.2, rearShoulderY: 3, frontShoulderY: 2 },
        { torsoY: -1, headY: -1, armY: 2, armY2: -8, legFrontX: -4, legFrontY: 0, legBackX: 2, legBackY: -1, gunX: -2, gunY: 1, gunW: 38, gunAngle: -0.14, rearShoulderX: -1, frontShoulderY: -2 },
        { torsoY: -2, headY: -2, armY: 0, armY2: -10, legFrontX: -5, legFrontY: 0, legBackX: 3, legBackY: -1, gunX: 3, gunY: -2, gunW: 40, gunAngle: -0.08, gunKick: 5, rearShoulderX: -1, frontShoulderY: -3 },
        { torsoY: 1, headY: 0, armY: 4, armY2: -4, legFrontX: -2, legFrontY: 1, legBackX: 1, legBackY: 1, gunX: -1, gunY: 4, gunW: 34, gunAngle: -0.02, rearShoulderY: 1, frontShoulderY: -1 },
      ],
      heavy: [
        { torsoY: 2, headY: 1, armY: 7, armY2: 0, legFrontX: -5, legFrontY: 2, legBackX: 2, legBackY: 0, gunX: -14, gunY: 10, gunW: 36, gunAngle: 0.26, rearShoulderY: 4, frontShoulderY: 2 },
        { torsoY: 0, headY: -1, armY: 4, armY2: -7, legFrontX: -6, legFrontY: 1, legBackX: 2, legBackY: -1, gunX: -4, gunY: 3, gunW: 42, gunAngle: -0.1, rearShoulderX: -2, frontShoulderY: -2 },
        { torsoY: -2, headY: -2, armY: 1, armY2: -12, legFrontX: -6, legFrontY: 0, legBackX: 3, legBackY: -2, gunX: 2, gunY: -3, gunW: 46, gunAngle: -0.02, rearShoulderX: -2, frontShoulderY: -4 },
        { torsoY: -1, headY: -2, armY: -1, armY2: -12, legFrontX: -5, legFrontY: 0, legBackX: 4, legBackY: -1, gunX: 8, gunY: -5, gunW: 48, gunAngle: 0.05, gunKick: 8, rearShoulderX: -2, frontShoulderY: -4 },
        { torsoY: 2, headY: 1, armY: 5, armY2: -2, legFrontX: -2, legFrontY: 1, legBackX: 1, legBackY: 1, gunX: 0, gunY: 5, gunW: 38, gunAngle: 0.08, rearShoulderY: 2, frontShoulderY: 0 },
      ],
      crouch: [
        { torsoY: 8, headY: 6, armY: 7, armY2: 0, legFrontX: -1, legFrontY: -6, legBackX: 1, legBackY: -6, gunX: 4, gunY: 12, gunW: 26, gunAngle: -0.08 },
        { torsoY: 9, headY: 7, armY: 7, armY2: 1, legFrontX: -2, legFrontY: -7, legBackX: 2, legBackY: -7, gunX: 4, gunY: 13, gunW: 26, gunAngle: -0.06 },
        { torsoY: 8, headY: 6, armY: 7, armY2: 0, legFrontX: -1, legFrontY: -6, legBackX: 1, legBackY: -6, gunX: 5, gunY: 12, gunW: 27, gunAngle: -0.08 },
      ],
    };

    const table = tables[state];
    if (!table) {
      return base;
    }

    return Object.assign({}, base, table[frame % table.length]);
  }

  function getPose(state, frame) {
    const base = {
      torsoY: 0,
      headY: 0,
      scarfY: 0,
      scarfTail: 2,
      scarfTrail: 0,
      armY: 0,
      armY2: 0,
      legFrontX: 0,
      legFrontY: 0,
      legBackX: 0,
      legBackY: 0,
      swordX: 6,
      swordY: 12,
      swordW: 24,
    };

    const tables = {
      idle: [
        { scarfTail: 3, scarfTrail: 0, swordY: 12 },
        { torsoY: -1, headY: -1, scarfY: -1, scarfTrail: 1, swordY: 11 },
        { scarfTail: 4, scarfTrail: 2, swordY: 12 },
        { torsoY: 1, headY: 1, scarfY: 1, scarfTrail: 1, swordY: 13 },
      ],
      crouch: [
        { torsoY: 8, headY: 6, scarfY: 4, scarfTail: 4, scarfTrail: 1, armY: 7, armY2: 5, legFrontX: -1, legFrontY: -6, legBackX: 1, legBackY: -6, swordX: 10, swordY: 18, swordW: 20 },
        { torsoY: 9, headY: 7, scarfY: 5, scarfTail: 5, scarfTrail: 2, armY: 8, armY2: 6, legFrontX: -2, legFrontY: -7, legBackX: 2, legBackY: -7, swordX: 9, swordY: 19, swordW: 19 },
        { torsoY: 8, headY: 6, scarfY: 4, scarfTail: 4, scarfTrail: 2, armY: 7, armY2: 5, legFrontX: -1, legFrontY: -6, legBackX: 1, legBackY: -6, swordX: 11, swordY: 18, swordW: 20 },
      ],
      run: [
        { legFrontX: -4, legFrontY: 3, legBackX: 3, legBackY: -2, armY: 2, armY2: -2, scarfTrail: 6, scarfTail: 8, swordY: 14 },
        { torsoY: -2, headY: -1, legFrontX: -2, legFrontY: 0, legBackX: 1, legBackY: 2, armY: -1, armY2: 1, scarfTrail: 8, scarfTail: 10, swordY: 11 },
        { legFrontX: 3, legFrontY: -2, legBackX: -3, legBackY: 3, armY: -2, armY2: 2, scarfTrail: 7, scarfTail: 9, swordY: 10 },
        { torsoY: -1, legFrontX: 2, legFrontY: 2, legBackX: -2, legBackY: -1, armY: 1, armY2: -1, scarfTrail: 6, scarfTail: 8, swordY: 12 },
        { torsoY: 1, headY: 1, legFrontX: -3, legFrontY: 1, legBackX: 3, legBackY: 1, armY: 2, armY2: -2, scarfTrail: 5, scarfTail: 7, swordY: 13 },
      ],
      jump: [
        { torsoY: -3, headY: -2, armY: -1, armY2: 2, legFrontX: 3, legFrontY: -5, legBackX: -4, legBackY: -3, scarfTrail: 4, scarfTail: 8, swordX: 2, swordY: 6, swordW: 22 },
        { torsoY: -6, headY: -4, armY: -5, armY2: -4, legFrontX: 6, legFrontY: -10, legBackX: -6, legBackY: -9, scarfTrail: 7, scarfTail: 10, swordX: -2, swordY: 1, swordW: 18 },
        { torsoY: -5, headY: -3, armY: 4, armY2: -2, legFrontX: -5, legFrontY: -9, legBackX: 5, legBackY: -10, scarfTrail: 8, scarfTail: 11, swordX: 16, swordY: 4, swordW: 18 },
        { torsoY: -1, headY: -1, armY: 2, armY2: 1, legFrontX: -2, legFrontY: -2, legBackX: 2, legBackY: -1, scarfTrail: 5, scarfTail: 8, swordX: 10, swordY: 10, swordW: 22 },
      ],
      wallslide: [
        { torsoY: 5, headY: 2, scarfY: 2, scarfTail: 6, scarfTrail: 3, armY: 10, armY2: -22, legFrontX: -10, legFrontY: -8, legBackX: 7, legBackY: 8, swordX: 18, swordY: 16, swordW: 16 },
        { torsoY: 6, headY: 3, scarfY: 3, scarfTail: 7, scarfTrail: 4, armY: 11, armY2: -24, legFrontX: -11, legFrontY: -10, legBackX: 8, legBackY: 10, swordX: 19, swordY: 17, swordW: 15 },
        { torsoY: 5, headY: 2, scarfY: 2, scarfTail: 7, scarfTrail: 5, armY: 10, armY2: -23, legFrontX: -10, legFrontY: -9, legBackX: 7, legBackY: 9, swordX: 18, swordY: 16, swordW: 16 },
      ],
      slash: [
        { armY: -2, armY2: -2, swordX: 10, swordY: 6, swordW: 22, scarfTrail: 6, scarfTail: 8 },
        { torsoY: -1, armY: -4, armY2: -3, swordX: 14, swordY: 0, swordW: 24, scarfTrail: 8, scarfTail: 10 },
        { torsoY: 1, armY: -1, armY2: 2, swordX: 19, swordY: -2, swordW: 28, scarfTrail: 9, scarfTail: 10 },
        { armY: 1, armY2: 3, swordX: 13, swordY: 3, swordW: 24, scarfTrail: 7, scarfTail: 8 },
      ],
      heavy: [
        { torsoY: 2, headY: 1, armY: 3, armY2: 2, swordX: -2, swordY: 10, swordW: 18, scarfTrail: 5, scarfTail: 8 },
        { torsoY: 0, headY: -1, armY: -4, armY2: -1, swordX: 4, swordY: 2, swordW: 12, scarfTrail: 7, scarfTail: 9 },
        { torsoY: -1, headY: -2, armY: -7, armY2: -3, swordX: 16, swordY: -8, swordW: 10, scarfTrail: 10, scarfTail: 12 },
        { torsoY: 1, headY: 0, armY: -1, armY2: 2, swordX: 24, swordY: -2, swordW: 12, scarfTrail: 11, scarfTail: 12 },
        { torsoY: 2, headY: 1, armY: 2, armY2: 3, swordX: 10, swordY: 6, swordW: 16, scarfTrail: 7, scarfTail: 9 },
      ],
      dash: [
        { torsoY: 4, headY: 2, scarfY: 1, armY: 4, armY2: -2, legFrontX: -7, legFrontY: -2, legBackX: 1, legBackY: 2, scarfTrail: 12, scarfTail: 14, swordX: 10, swordY: 14, swordW: 24 },
        { torsoY: 1, headY: -1, scarfY: -1, armY: 1, armY2: -5, legFrontX: -9, legFrontY: -4, legBackX: 3, legBackY: 4, scarfTrail: 16, scarfTail: 17, swordX: 18, swordY: 7, swordW: 28 },
        { torsoY: 0, headY: -2, scarfY: -1, armY: 0, armY2: -6, legFrontX: -8, legFrontY: -5, legBackX: 4, legBackY: 5, scarfTrail: 18, scarfTail: 18, swordX: 24, swordY: 3, swordW: 30 },
        { torsoY: 2, headY: 0, scarfY: 0, armY: 2, armY2: -3, legFrontX: -5, legFrontY: -2, legBackX: 4, legBackY: 2, scarfTrail: 13, scarfTail: 15, swordX: 16, swordY: 9, swordW: 26 },
      ],
      evade: [
        { torsoY: 3, headY: 2, armY: -2, armY2: 1, legFrontX: -5, legBackX: -2, scarfTrail: 14, scarfTail: 16, swordX: 6, swordY: 14, swordW: 20 },
        { torsoY: 1, headY: 0, armY: -4, armY2: -1, legFrontX: -7, legBackX: 0, scarfTrail: 18, scarfTail: 18, swordX: 12, swordY: 8, swordW: 22 },
        { torsoY: 0, headY: -1, armY: -3, armY2: -2, legFrontX: -6, legBackX: 1, scarfTrail: 20, scarfTail: 20, swordX: 16, swordY: 6, swordW: 24 },
        { torsoY: 2, headY: 1, armY: 0, armY2: 1, legFrontX: -3, legBackX: 2, scarfTrail: 14, scarfTail: 15, swordX: 10, swordY: 10, swordW: 21 },
      ],
      hurt: [
        { torsoY: 1, headY: 1, swordY: 14, scarfTrail: 4, scarfTail: 5 },
        { torsoY: -1, headY: -1, swordY: 11, scarfTrail: 5, scarfTail: 6 },
        { torsoY: 1, headY: 1, swordY: 13, scarfTrail: 3, scarfTail: 5 },
      ],
    };

    const table = tables[state] || tables.idle;
    return Object.assign(base, table[frame % table.length]);
  }

  function drawSlashTrail(ctx, player) {
    if (player.character === "sniper") {
      drawSniperTrail(ctx, player);
      return;
    }

    const power = player.activeAttack && player.activeAttack.type === "heavy" ? 1.2 : 0.9;
    const alpha = Math.max(0, player.slashArc / 16);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (player.slashArcMode === "circle") {
      const radius = power > 1 ? 50 : 40;
      const spinOffset = (16 - player.slashArc) * 0.28;
      ctx.strokeStyle = power > 1 ? "#c8fbff" : "#7ae8ff";
      ctx.lineWidth = power > 1 ? 7 : 5;
      ctx.beginPath();
      ctx.arc(0, -2, radius, spinOffset, spinOffset + Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = power > 1 ? "rgba(80,210,255,0.56)" : "rgba(30,175,255,0.46)";
      ctx.lineWidth = power > 1 ? 5 : 4;
      ctx.beginPath();
      ctx.arc(0, -2, radius + 12, -spinOffset, -spinOffset + Math.PI * 2);
      ctx.stroke();
    } else if (player.slashArcMode === "shot") {
      ctx.strokeStyle = "rgba(140, 240, 255, 0.78)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(12, -4, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.rotate((16 - player.slashArc) * 0.45);
      ctx.fillStyle = "rgba(180, 250, 255, 0.92)";
      for (let i = 0; i < 4; i += 1) {
        ctx.rotate(Math.PI / 2);
        ctx.fillRect(12, -2, 11, 4);
      }
    } else {
      ctx.strokeStyle = power > 1 ? "#b5f8ff" : "#7ae8ff";
      ctx.lineWidth = power > 1 ? 8 : 6;
      ctx.beginPath();
      ctx.arc(12, -4, 26 + power * 12, -1.2, 0.65);
      ctx.stroke();
      ctx.strokeStyle = power > 1 ? "rgba(80,210,255,0.55)" : "rgba(30,175,255,0.45)";
      ctx.lineWidth = power > 1 ? 14 : 10;
      ctx.beginPath();
      ctx.arc(12, -4, 26 + power * 12, -1.15, 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSniperTrail(ctx, player) {
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, player.slashArc / 12);

    if (player.activeAttack && player.activeAttack.type === "smash") {
      ctx.fillStyle = "rgba(210, 210, 210, 0.34)";
      ctx.beginPath();
      ctx.arc(0, 18, 24, 0, Math.PI * 2);
      ctx.arc(-18, 20, 12, 0, Math.PI * 2);
      ctx.arc(16, 22, 14, 0, Math.PI * 2);
      ctx.fill();
    } else if (player.activeAttack) {
      const heavyShot = player.activeAttack.type === "heavy";
      const length = heavyShot ? 150 : 112;
      ctx.strokeStyle = heavyShot ? "#ffe1a0" : "#f2c86c";
      ctx.lineWidth = heavyShot ? 6 : 4;
      ctx.beginPath();
      ctx.moveTo(14, -8);
      ctx.lineTo(length, -8);
      ctx.stroke();
      ctx.strokeStyle = heavyShot ? "rgba(255, 198, 92, 0.38)" : "rgba(212, 168, 79, 0.32)";
      ctx.lineWidth = heavyShot ? 12 : 8;
      ctx.beginPath();
      ctx.moveTo(14, -8);
      ctx.lineTo(length + 10, -8);
      ctx.stroke();
      ctx.fillStyle = heavyShot ? "#fff2ca" : "#ffe0a1";
      ctx.beginPath();
      ctx.arc(length + 4, -8, heavyShot ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (player.sniperAimFlash > 0) {
      ctx.strokeStyle = "rgba(255, 225, 144, 0.82)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, -16);
      ctx.lineTo(88, -40);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderEffects(ctx, camera, effects) {
    effects.forEach((effect) => {
      const px = effect.x - camera.x;
      const py = effect.y - camera.y;
      const t = effect.timer / effect.maxTimer;

      ctx.save();
      ctx.translate(Math.round(px), Math.round(py));
      ctx.scale(effect.facing, 1);
      ctx.globalAlpha = Math.max(0.15, t);

      if (effect.type === "dash") {
        ctx.fillStyle = "rgba(70, 180, 255, 0.24)";
        ctx.fillRect(-44, -18, 52, 38);
        ctx.fillStyle = "rgba(210, 60, 90, 0.22)";
        ctx.fillRect(-36, -12, 44, 22);
      } else if (effect.type === "slideDash") {
        ctx.fillStyle = "rgba(70, 180, 255, 0.26)";
        ctx.fillRect(-50, -10, 60, 22);
        ctx.fillStyle = "rgba(210, 60, 90, 0.16)";
        ctx.fillRect(-42, -6, 52, 14);
      } else if (effect.type === "evade") {
        ctx.fillStyle = "rgba(70, 180, 255, 0.18)";
        ctx.fillRect(-38, -20, 52, 40);
        ctx.fillStyle = "rgba(220, 245, 255, 0.14)";
        ctx.fillRect(-26, -16, 32, 32);
      } else if (effect.type === "specialPulse") {
        ctx.strokeStyle = "rgba(165, 244, 255, 0.8)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, 18 + (1 - t) * 24, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.type === "doubleJump") {
        ctx.strokeStyle = "rgba(169, 243, 255, 0.95)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 6, 16 + (1 - t) * 10, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        ctx.strokeStyle = "rgba(88, 186, 255, 0.65)";
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(0, 6, 16 + (1 - t) * 10, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
      } else if (effect.type === "jump") {
        ctx.fillStyle = "rgba(120, 210, 255, 0.4)";
        ctx.fillRect(-16, 18, 30, 6);
      } else if (effect.type === "hit") {
        ctx.strokeStyle = "#8bf6ff";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 10 + (1 - t) * 14, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.type === "sniperShot" || effect.type === "sniperHeavy") {
        const heavyShot = effect.type === "sniperHeavy";
        ctx.strokeStyle = heavyShot ? "#ffe2a7" : "#f0c56c";
        ctx.lineWidth = heavyShot ? 6 : 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(heavyShot ? 132 : 96, -2);
        ctx.stroke();
        ctx.strokeStyle = heavyShot ? "rgba(255, 206, 112, 0.35)" : "rgba(214, 168, 79, 0.3)";
        ctx.lineWidth = heavyShot ? 14 : 10;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(heavyShot ? 142 : 104, -2);
        ctx.stroke();
        ctx.fillStyle = "#fff2c7";
        ctx.beginPath();
        ctx.arc(heavyShot ? 138 : 100, -2, heavyShot ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.type === "sniperImpact") {
        ctx.strokeStyle = "rgba(255, 226, 142, 0.9)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, 12 + (1 - t) * 18, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.type === "shuriken") {
        ctx.strokeStyle = "rgba(150, 235, 255, 0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 10 + (1 - t) * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate((1 - t) * Math.PI * 2);
        ctx.fillStyle = "rgba(190, 248, 255, 0.92)";
        for (let i = 0; i < 4; i += 1) {
          ctx.rotate(Math.PI / 2);
          ctx.fillRect(0, -2, 12, 4);
        }
      } else if (effect.type === "smoke") {
        ctx.fillStyle = "rgba(214, 214, 214, 0.3)";
        ctx.beginPath();
        ctx.arc(-10, 0, 12 + (1 - t) * 10, 0, Math.PI * 2);
        ctx.arc(4, -4, 10 + (1 - t) * 8, 0, Math.PI * 2);
        ctx.arc(16, 2, 8 + (1 - t) * 7, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.type === "sniperAim") {
        ctx.strokeStyle = "rgba(255, 224, 138, 0.88)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 20 + (1 - t) * 12, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = effect.type === "heavy" ? "#b9faff" : "#78e6ff";
        ctx.lineWidth = effect.type === "heavy" ? 10 : 6;
        ctx.beginPath();
        ctx.arc(-4, 0, effect.type === "heavy" ? 42 : 30, -0.95, 0.42);
        ctx.stroke();
      }

      ctx.restore();
    });
  }

  window.GamePlayer = {
    createPlayer,
    updatePlayer,
    renderPlayer,
    setGrounded,
    hurtPlayer,
    respawnPlayer,
    resetPlayer,
    setSpawn,
    setCharacter,
  };
}());
