(function () {
  const {
    Engine,
    Events,
    Body,
  } = Matter;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const gameOverScreen = document.getElementById("game-over");
  const continueBtn = document.getElementById("continue-btn");
  const restartBtn = document.getElementById("restart-btn");
  ctx.imageSmoothingEnabled = false;

  const engine = Engine.create();
  engine.gravity.y = 1.05;

  const worldState = GameWorld.createWorld(engine);
  const player = GamePlayer.createPlayer(engine, worldState.spawn);

  const input = {
    left: false,
    right: false,
    down: false,
    jumpPressed: false,
    attackPressed: false,
    heavyPressed: false,
    dashPressed: false,
    evadePressed: false,
    specialPressed: false,
  };

  const contactState = {
    groundContacts: 0,
  };

  const camera = {
    x: 0,
    y: 0,
  };

  const overlay = {
    message: "Llega al final del templo sin perder tus tres vidas.",
    timer: 240,
  };

  let isGameOver = false;

  window.setInterval(() => {
    GameWorld.spawnMeteorShower(worldState);
  }, 5000);

  continueBtn.addEventListener("click", continueGame);
  restartBtn.addEventListener("click", restartGame);

  const keys = new Set();

  window.addEventListener("keydown", (event) => {
    const code = event.code;
    GameAudio.unlock();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "ShiftLeft", "ShiftRight"].includes(code)) {
      event.preventDefault();
    }

    if (!keys.has(code)) {
      if (code === "Space" || code === "KeyW" || code === "ArrowUp") input.jumpPressed = true;
      if (code === "KeyJ") input.attackPressed = true;
      if (code === "KeyK") input.heavyPressed = true;
      if (code === "ShiftLeft" || code === "ShiftRight") input.dashPressed = true;
      if (code === "KeyL") input.evadePressed = true;
      if (code === "KeyU") input.specialPressed = true;
    }

    keys.add(code);
    syncMovement();
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    syncMovement();
  });

  function syncMovement() {
    input.left = keys.has("KeyA") || keys.has("ArrowLeft");
    input.right = keys.has("KeyD") || keys.has("ArrowRight");
    input.down = keys.has("KeyS") || keys.has("ArrowDown");
  }

  Events.on(engine, "collisionStart", (event) => {
    event.pairs.forEach(handleCollisionPair);
  });

  Events.on(engine, "collisionActive", (event) => {
    event.pairs.forEach(handleCollisionPair);
  });

  Events.on(engine, "collisionEnd", (event) => {
    event.pairs.forEach((pair) => {
      const labels = [pair.bodyA.label, pair.bodyB.label];
      if (labels.includes("player") && (labels.includes("ground") || labels.includes("solid") || labels.includes("wall"))) {
        contactState.groundContacts = Math.max(0, contactState.groundContacts - 1);
      }
    });
  });

  function handleCollisionPair(pair) {
    const playerBody = pair.bodyA.label === "player" ? pair.bodyA : pair.bodyB.label === "player" ? pair.bodyB : null;
    const otherBody = playerBody === pair.bodyA ? pair.bodyB : pair.bodyA;
    const projectileBody = pair.bodyA.label === "projectile" ? pair.bodyA : pair.bodyB.label === "projectile" ? pair.bodyB : null;
    const projectileOther = projectileBody === pair.bodyA ? pair.bodyB : pair.bodyA;
    const skyProjectileBody = pair.bodyA.label === "skyProjectile" ? pair.bodyA : pair.bodyB.label === "skyProjectile" ? pair.bodyB : null;
    const skyProjectileOther = skyProjectileBody === pair.bodyA ? pair.bodyB : pair.bodyA;

    if (projectileBody && projectileOther) {
      if (["ground", "solid", "wall", "hazard", "player"].includes(projectileOther.label)) {
        if (projectileOther.label === "player") {
          sufferHit();
        }
        GameWorld.removeProjectile(engine, worldState, projectileBody);
      }
    }

    if (skyProjectileBody && skyProjectileOther) {
      if (["ground", "solid", "wall", "hazard", "player"].includes(skyProjectileOther.label)) {
        if (skyProjectileOther.label === "player") {
          sufferHit();
        }
        GameWorld.finishSkyStrike(engine, worldState);
      }
    }

    if (!playerBody || !otherBody) {
      return;
    }

    if (otherBody.label === "ground" || otherBody.label === "solid" || otherBody.label === "wall") {
      const normal = pair.collision.normal;
      const hitFromAbove = pair.bodyA === playerBody ? normal.y < -0.2 : normal.y > 0.2;
      if (hitFromAbove) {
        contactState.groundContacts += 1;
      }
    }

    if (otherBody.label === "hazard" || otherBody.label === "enemy" || otherBody.label === "projectile" || otherBody.label === "skyProjectile") {
      sufferHit();
    }
  }

  function sufferHit() {
    if (isGameOver) {
      return;
    }

    const changed = GamePlayer.hurtPlayer(player);
    if (!changed) {
      return;
    }

    overlay.message = player.lives > 0 ? "Has sido herido. Regresas al ultimo punto seguro." : "Has caido. El ronin vuelve al inicio.";
    overlay.timer = 120;

    if (player.lives <= 0) {
      showGameOver();
    } else {
      GamePlayer.respawnPlayer(player);
    }
  }

  function showGameOver() {
    isGameOver = true;
    gameOverScreen.classList.remove("hidden");
    gameOverScreen.setAttribute("aria-hidden", "false");
    overlay.message = "Operacion comprometida.";
    overlay.timer = 120;
  }

  function hideGameOver() {
    isGameOver = false;
    gameOverScreen.classList.add("hidden");
    gameOverScreen.setAttribute("aria-hidden", "true");
  }

  function continueGame() {
    player.lives = 3;
    GamePlayer.respawnPlayer(player);
    hideGameOver();
    overlay.message = "Operacion reanudada desde el ultimo punto seguro.";
    overlay.timer = 160;
  }

  function restartGame() {
    hideGameOver();
    restartAtLevel(1, "Operacion reiniciada desde el nivel 1.");
  }

  function restartAtLevel(levelNumber, message) {
    GameWorld.buildLevel(engine, worldState, levelNumber);
    GamePlayer.setSpawn(player, worldState.spawn);
    GamePlayer.resetPlayer(player);
    camera.x = 0;
    camera.y = 0;
    overlay.message = message;
    overlay.timer = 180;
  }

  function advanceLevel() {
    const nextLevel = worldState.level + 1;
    GameWorld.buildLevel(engine, worldState, nextLevel);
    GamePlayer.setSpawn(player, worldState.spawn);
    GamePlayer.resetPlayer(player);
    camera.x = 0;
    camera.y = 0;
    overlay.message = `Nivel ${nextLevel}. Nuevo santuario aleatorio generado.`;
    overlay.timer = 220;
  }

  function update() {
    if (isGameOver) {
      return;
    }

    contactState.groundContacts = 0;
    Engine.update(engine, 1000 / 60);

    GamePlayer.setGrounded(player, contactState.groundContacts > 0);
    GameWorld.updateEnemies(worldState);
    GameWorld.updateCombat(engine, worldState, player);
    GameWorld.updateSkyEvent(engine, worldState, player);
    GamePlayer.updatePlayer(player, input, worldState);

    const openGate = worldState.skyEvent.gate;
    if (openGate) {
      const playerX = player.body.position.x;
      const playerFeetY = player.body.position.y + (player.height / 2);
      const insideGap = playerX > openGate.x - (openGate.width / 2) && playerX < openGate.x + (openGate.width / 2);
      const belowFloorTop = playerFeetY > openGate.topY + 18;
      if (insideGap && belowFloorTop) {
        sufferHit();
      }
    }

    if (player.body.position.y > worldState.bounds.height) {
      sufferHit();
    }

    if (player.body.position.x >= worldState.goal.x - 14) {
      advanceLevel();
    }

    const targetCameraX = player.body.position.x - canvas.width * 0.35;
    camera.x += (targetCameraX - camera.x) * 0.12;
    camera.x = Math.max(0, Math.min(camera.x, worldState.bounds.width - canvas.width));

    input.jumpPressed = false;
    input.attackPressed = false;
    input.heavyPressed = false;
    input.dashPressed = false;
    input.evadePressed = false;
    input.specialPressed = false;

    if (overlay.timer > 0) {
      overlay.timer -= 1;
    }
  }

  function render() {
    GameWorld.renderWorld(ctx, camera, worldState, canvas);
    GamePlayer.renderPlayer(ctx, camera, player);
    renderHud();
  }

  function renderHud() {
    ctx.save();
    ctx.fillStyle = "rgba(5, 8, 18, 0.7)";
    ctx.fillRect(16, 16, 248, 76);
    ctx.strokeStyle = "rgba(246, 210, 125, 0.45)";
    ctx.strokeRect(16.5, 16.5, 248, 76);

    ctx.fillStyle = "#f6d27d";
    ctx.font = "16px Courier New";
    ctx.fillText("VIDAS", 28, 40);
    ctx.fillText("POS", 28, 66);
    ctx.fillText("PTS", 28, 90);
    ctx.fillText(`LVL ${worldState.level}`, 146, 40);

    for (let i = 0; i < 3; i += 1) {
      const x = 94 + i * 28;
      ctx.fillStyle = i < player.lives ? "#ff587b" : "#39263d";
      ctx.fillRect(x, 28, 18, 16);
      ctx.fillStyle = i < player.lives ? "#ffd0d7" : "#71536e";
      ctx.fillRect(x + 3, 31, 12, 10);
    }

    ctx.fillStyle = "#d2dbef";
    ctx.fillText(`${Math.floor(player.body.position.x)}m`, 94, 66);
    ctx.fillText(`${player.score}`, 94, 90);
    ctx.fillText(`META ${Math.floor(worldState.goal.x)}m`, 146, 66);

    const abilityBars = [
      { label: "J", value: player.attackCooldown, max: 16, x: 284 },
      { label: "K", value: player.heavyCooldown, max: 22, x: 352 },
      { label: "DASH", value: player.dashCooldown, max: 46, x: 420 },
      { label: "L", value: player.evadeCooldown, max: 54, x: 504 },
      { label: "U", value: player.specialCooldown, max: 300, x: 556 },
    ];

    abilityBars.forEach((bar) => {
      const width = bar.label === "DASH" ? 72 : 48;
      ctx.fillStyle = "rgba(5, 8, 18, 0.62)";
      ctx.fillRect(bar.x, 16, width, 30);
      ctx.strokeStyle = "rgba(160, 190, 255, 0.3)";
      ctx.strokeRect(bar.x + 0.5, 16.5, width, 30);
      ctx.fillStyle = "#f6d27d";
      ctx.font = "12px Courier New";
      ctx.fillText(bar.label, bar.x + 8, 35);
      ctx.fillStyle = "#6fe7ff";
      const ready = 1 - Math.min(bar.value / bar.max, 1);
      ctx.fillRect(bar.x + 2, 40, Math.floor((width - 4) * ready), 4);
    });

    if (overlay.timer > 0) {
      const width = Math.min(canvas.width - 120, 560);
      const x = (canvas.width - width) / 2;
      ctx.fillStyle = "rgba(4, 6, 14, 0.75)";
      ctx.fillRect(x, canvas.height - 72, width, 38);
      ctx.strokeStyle = "rgba(111, 231, 255, 0.35)";
      ctx.strokeRect(x + 0.5, canvas.height - 71.5, width, 38);
      ctx.fillStyle = "#edf3ff";
      ctx.font = "14px Courier New";
      ctx.fillText(overlay.message, x + 14, canvas.height - 48);
    }

    ctx.restore();
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  overlay.message = "El viento helado del ronin ya esta en marcha.";
  overlay.timer = 160;
  loop();
}());
