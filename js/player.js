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
      body,
      width,
      height,
      facing: 1,
      onGround: false,
      spawn: { x: spawn.x, y: spawn.y },
      lives: 3,
      score: 0,
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

    if (input.attackPressed && player.attackCooldown <= 0 && player.actionLock <= 0) {
      startAttack(player, "slash", 16, 18, 70, 52, 1);
    }

    if (input.heavyPressed && player.heavyCooldown <= 0 && player.actionLock <= 0) {
      startAttack(player, "heavy", 22, 26, 92, 62, 2);
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
      startSpecialWave(player);
    }

    updateAttack(player, worldState);
    updateSpecialWave(player, worldState);
    updateEffects(player);
    updateSafePoint(player);
    updateAnimation(player, moveDir, isCrouching);
    tickTimers(player);
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
      radius: airborne ? (type === "heavy" ? 86 : 70) : 0,
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
        player.score += player.activeAttack.type === "heavy" ? 150 : 100;
        Body.setVelocity(enemy.body, {
          x: player.facing * 8,
          y: -5,
        });
        pushEffect(player, "hit", enemy.body.position.x, enemy.body.position.y - 10, player.facing);
      }
    });
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
        player.score += 200;
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

  function updateAnimation(player, moveDir, isCrouching) {
    let nextState = "idle";

    if (player.invulnerableTimer > 0 && player.hitPause > 0) {
      nextState = "hurt";
    } else if (player.evadeTimer > 0) {
      nextState = "evade";
    } else if (player.dashTimer > 0) {
      nextState = "dash";
    } else if (player.activeAttack && player.activeAttack.type === "heavy") {
      nextState = "heavy";
    } else if (player.activeAttack) {
      nextState = "slash";
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
    Body.setPosition(player.body, getBodyPositionFromSpawn(player, spawn));
    Body.setVelocity(player.body, { x: 0, y: 0 });
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
      drawRoninFrame(ctx, player.state, frame);
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
      slash: [
        { armY: -2, armY2: -2, swordX: 10, swordY: 6, swordW: 22, scarfTrail: 6, scarfTail: 8 },
        { torsoY: -1, armY: -4, armY2: -3, swordX: 14, swordY: 0, swordW: 24, scarfTrail: 8, scarfTail: 10 },
        { torsoY: 1, armY: -1, armY2: 2, swordX: 19, swordY: -2, swordW: 28, scarfTrail: 9, scarfTail: 10 },
        { armY: 1, armY2: 3, swordX: 13, swordY: 3, swordW: 24, scarfTrail: 7, scarfTail: 8 },
      ],
      heavy: [
        { torsoY: 1, armY: -1, armY2: 1, swordX: 8, swordY: 10, swordW: 24, scarfTrail: 6, scarfTail: 9 },
        { torsoY: -1, headY: -1, armY: -5, armY2: -2, swordX: 16, swordY: -6, swordW: 28, scarfTrail: 8, scarfTail: 10 },
        { torsoY: -2, headY: -2, armY: -6, armY2: -4, swordX: 20, swordY: -13, swordW: 32, scarfTrail: 10, scarfTail: 11 },
        { torsoY: 0, armY: -2, armY2: 1, swordX: 28, swordY: -4, swordW: 34, scarfTrail: 12, scarfTail: 12 },
        { torsoY: 2, armY: 2, armY2: 4, swordX: 18, swordY: 6, swordW: 26, scarfTrail: 8, scarfTail: 9 },
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
    const power = player.activeAttack && player.activeAttack.type === "heavy" ? 1.2 : 0.9;
    const alpha = Math.max(0, player.slashArc / 16);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (player.slashArcMode === "circle") {
      const radius = power > 1 ? 38 : 31;
      const spinOffset = (16 - player.slashArc) * 0.28;
      ctx.strokeStyle = power > 1 ? "#c8fbff" : "#7ae8ff";
      ctx.lineWidth = power > 1 ? 7 : 5;
      ctx.beginPath();
      ctx.arc(0, -2, radius, spinOffset, spinOffset + Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = power > 1 ? "rgba(80,210,255,0.56)" : "rgba(30,175,255,0.46)";
      ctx.lineWidth = power > 1 ? 5 : 4;
      ctx.beginPath();
      ctx.arc(0, -2, radius + 10, -spinOffset, -spinOffset + Math.PI * 2);
      ctx.stroke();
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
  };
}());
