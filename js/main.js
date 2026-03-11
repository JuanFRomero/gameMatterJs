(function () {
  const {
    Engine,
    Events,
    Body,
  } = Matter;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mainMenu = document.getElementById("main-menu");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-btn"));
  const characterButtons = Array.from(document.querySelectorAll(".character-btn"));
  const skinButtons = Array.from(document.querySelectorAll(".skin-btn"));
  const modeStandardBtn = document.getElementById("mode-standard");
  const modeCircuitBtn = document.getElementById("mode-circuit");
  const exportBoardBtn = document.getElementById("export-board");
  const importBoardBtn = document.getElementById("import-board");
  const boardJson = document.getElementById("board-json");
  const currentCharacterLabel = document.getElementById("current-character-label");
  const gameOverScreen = document.getElementById("game-over");
  const continueBtn = document.getElementById("continue-btn");
  const restartBtn = document.getElementById("restart-btn");
  ctx.imageSmoothingEnabled = false;

  const engine = Engine.create();
  engine.gravity.y = 1.05;
  const MAX_LEVELS = 10;
  const STORAGE_KEYS = {
    score: "kage-ryu-score",
    highScore: "kage-ryu-high-score",
    difficulty: "kage-ryu-difficulty",
    mode: "kage-ryu-mode",
    skin: "kage-ryu-skin",
    character: "kage-ryu-character",
  };

  const worldState = GameWorld.createWorld(engine);
  loadStoredBoardPrefs();
  const player = GamePlayer.createPlayer(engine, worldState.spawn);
  loadStoredScore(player);
  loadStoredCharacter(player);

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
  let gameStarted = false;
  let pendingLevelAdvance = 0;
  let levelTimerFrames = 0;
  let lastStoredScore = player.score;
  let lastStoredHighScore = player.highScore;

  window.setInterval(() => {
    GameWorld.spawnMeteorShower(worldState);
  }, 5000);

  continueBtn.addEventListener("click", continueGame);
  restartBtn.addEventListener("click", restartGame);
  difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      startGame(button.dataset.difficulty || "medium");
    });
  });
  characterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setCharacter(button.dataset.character || "ronin");
    });
  });
  skinButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSkin(button.dataset.skin || "neon");
    });
  });
  modeStandardBtn.addEventListener("click", () => setMode("standard"));
  modeCircuitBtn.addEventListener("click", () => setMode("circuit"));
  exportBoardBtn.addEventListener("click", exportBoardConfig);
  importBoardBtn.addEventListener("click", importBoardConfig);

  const keys = new Set();

  window.addEventListener("keydown", (event) => {
    const code = event.code;
    GameAudio.unlock();
    if (!gameStarted) {
      if (code === "Digit1") startGame("easy");
      if (code === "Digit2") startGame("medium");
      if (code === "Digit3") startGame("hard");
      return;
    }

    if (isGameOver) {
      if (code === "KeyC") {
        continueGame();
        return;
      }
      if (code === "KeyR") {
        restartGame();
        return;
      }
    }

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
      if (labels.includes("player") && (labels.includes("ground") || labels.includes("solid") || labels.includes("wall") || labels.includes("climbWall") || labels.includes("ramp") || labels.includes("door"))) {
        contactState.groundContacts = Math.max(0, contactState.groundContacts - 1);
      }
    });
  });

  function handleCollisionPair(pair) {
    const playerBody = pair.bodyA.label === "player" ? pair.bodyA : pair.bodyB.label === "player" ? pair.bodyB : null;
    const otherBody = playerBody === pair.bodyA ? pair.bodyB : pair.bodyA;
    const projectileBody = pair.bodyA.label === "projectile" ? pair.bodyA : pair.bodyB.label === "projectile" ? pair.bodyB : null;
    const projectileOther = projectileBody === pair.bodyA ? pair.bodyB : pair.bodyA;
    const playerProjectileBody = pair.bodyA.label === "playerProjectile" ? pair.bodyA : pair.bodyB.label === "playerProjectile" ? pair.bodyB : null;
    const playerProjectileOther = playerProjectileBody === pair.bodyA ? pair.bodyB : pair.bodyA;
    const skyProjectileBody = pair.bodyA.label === "skyProjectile" ? pair.bodyA : pair.bodyB.label === "skyProjectile" ? pair.bodyB : null;
    const skyProjectileOther = skyProjectileBody === pair.bodyA ? pair.bodyB : pair.bodyA;

    if (projectileBody && projectileOther) {
      if (projectileOther.label === "peg") {
        GameWorld.deflectProjectile(worldState, projectileBody, projectileOther);
      } else if (["ground", "solid", "wall", "hazard", "player", "bouncer", "door", "ramp"].includes(projectileOther.label)) {
        if (projectileOther.label === "player") {
          sufferHit();
        }
        GameWorld.removeProjectile(engine, worldState, projectileBody);
      }
    }

    if (playerProjectileBody && playerProjectileOther) {
      const projectile = worldState.playerProjectiles.find((item) => item.body === playerProjectileBody);
      if (playerProjectileOther.label === "enemy") {
        const enemy = worldState.enemies.find((item) => item.body === playerProjectileOther);
        if (projectile && projectile.kind === "slingshot") {
          const defeats = GameWorld.explodeRyanSpecial(engine, worldState, playerProjectileBody);
          if (defeats > 0) {
            player.score += worldState.mode === "circuit" ? defeats * 50 : defeats * 240;
            player.highScore = Math.max(player.highScore, player.score);
          }
          return;
        }
        if (enemy && enemy.alive) {
          enemy.alive = false;
          enemy.hitFlash = 14;
          const hitImpulse = projectile
            ? Math.max(6, Math.hypot(playerProjectileBody.velocity.x, playerProjectileBody.velocity.y))
            : 8;
          player.score += worldState.mode === "circuit"
            ? 40
            : projectile && projectile.kind === "sniperHeavy" ? 180 : projectile && projectile.kind === "shuriken" ? 130 : 110;
          player.highScore = Math.max(player.highScore, player.score);
          Body.setVelocity(enemy.body, {
            x: Math.sign(playerProjectileBody.velocity.x || player.facing) * hitImpulse,
            y: Math.min(-2, playerProjectileBody.velocity.y * 0.35),
          });
        }
        GameWorld.removePlayerProjectile(engine, worldState, playerProjectileBody);
      } else if (["ground", "solid", "wall", "hazard", "bouncer", "door", "ramp"].includes(playerProjectileOther.label)) {
        if (projectile && projectile.kind === "slingshot") {
          const defeats = GameWorld.explodeRyanSpecial(engine, worldState, playerProjectileBody);
          if (defeats > 0) {
            player.score += worldState.mode === "circuit" ? defeats * 50 : defeats * 240;
            player.highScore = Math.max(player.highScore, player.score);
          }
        } else {
          GameWorld.removePlayerProjectile(engine, worldState, playerProjectileBody);
        }
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

    if (otherBody.label === "ground" || otherBody.label === "solid" || otherBody.label === "wall" || otherBody.label === "climbWall" || otherBody.label === "ramp" || otherBody.label === "door") {
      const normal = pair.collision.normal;
      const hitFromAbove = pair.bodyA === playerBody ? normal.y < -0.2 : normal.y > 0.2;
      if (hitFromAbove) {
        contactState.groundContacts += 1;
      }
    }

    if (otherBody.label === "bouncer") {
      const normal = pair.collision.normal;
      const hitFromAbove = pair.bodyA === playerBody ? normal.y < -0.2 : normal.y > 0.2;
      if (hitFromAbove) {
        const horizontalBoost = Math.max(-7.5, Math.min(7.5, player.body.velocity.x * 1.35));
        Body.setVelocity(player.body, {
          x: horizontalBoost,
          y: -15.5,
        });
        GameAudio.playBounce(Math.min(1, Math.abs(horizontalBoost) / 8));
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
    syncStoredScore();
    hideGameOver();
    overlay.message = "Operacion reanudada desde el ultimo punto seguro.";
    overlay.timer = 160;
  }

  function restartGame() {
    hideGameOver();
    restartAtLevel(1, "Operacion reiniciada desde el nivel 1.");
  }

  function restartAtLevel(levelNumber, message) {
    pendingLevelAdvance = 0;
    levelTimerFrames = 0;
    GameWorld.buildLevel(engine, worldState, levelNumber);
    GamePlayer.setSpawn(player, worldState.spawn);
    GamePlayer.resetPlayer(player);
    player.highScore = Math.max(player.highScore, player.score);
    syncStoredScore();
    camera.x = 0;
    camera.y = 0;
    overlay.message = message;
    overlay.timer = 180;
  }

  function advanceLevel() {
    if (worldState.level >= MAX_LEVELS) {
      restartAtLevel(1, "Campana completada. El ronin vuelve al nivel 1.");
      return;
    }

    const nextLevel = worldState.level + 1;
    GameWorld.buildLevel(engine, worldState, nextLevel);
    GamePlayer.setSpawn(player, worldState.spawn);
    GamePlayer.resetPlayer(player);
    player.highScore = Math.max(player.highScore, player.score);
    syncStoredScore();
    pendingLevelAdvance = 0;
    levelTimerFrames = 0;
    camera.x = 0;
    camera.y = 0;
    overlay.message = worldState.mode === "circuit"
      ? `Nivel ${nextLevel}/${MAX_LEVELS}. Circuito reiniciado: corre hacia la meta.`
      : `Nivel ${nextLevel}/${MAX_LEVELS}. Dificultad en aumento.`;
    overlay.timer = 220;
  }

  function update() {
    if (!gameStarted || isGameOver) {
      return;
    }

    if (pendingLevelAdvance > 0) {
      pendingLevelAdvance -= 1;
      if (pendingLevelAdvance <= 0) {
        advanceLevel();
      }
      return;
    }

    levelTimerFrames += 1;
    contactState.groundContacts = 0;
    Engine.update(engine, 1000 / 60);

    GamePlayer.setGrounded(player, contactState.groundContacts > 0);
    GameWorld.updateEnemies(worldState);
    GameWorld.updateCombat(engine, worldState, player);
    GameWorld.updatePlayerProjectiles(engine, worldState);
    GameWorld.updateCircuit(worldState);
    GameWorld.updateSkyEvent(engine, worldState, player);
    GameWorld.applyTeleports(worldState, player);
    GamePlayer.updatePlayer(player, input, worldState);
    syncStoredScore();

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
      if (worldState.mode === "circuit") {
        const seconds = (levelTimerFrames / 60).toFixed(2);
        overlay.message = `Meta alcanzada en ${seconds}s.`;
        overlay.timer = 150;
        pendingLevelAdvance = 42;
      } else {
        const slot = GameWorld.claimScoreSlot(worldState, player.body);
        if (slot) {
          player.score += slot.value;
          player.highScore = Math.max(player.highScore, player.score);
          overlay.message = `Cajon de puntuacion: +${slot.value} puntos.`;
          overlay.timer = 150;
          syncStoredScore();
          pendingLevelAdvance = 42;
        } else if (worldState.scoreSlots.length === 0) {
          advanceLevel();
        }
      }
    }

    if (worldState.mode !== "circuit" && player.body.position.x >= worldState.goal.x - 14 && worldState.scoreSlots.length === 0) {
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
    if (!gameStarted) {
      return;
    }

    ctx.save();
    ctx.fillStyle = "rgba(5, 8, 18, 0.7)";
    ctx.fillRect(16, 16, 248, 76);
    ctx.strokeStyle = "rgba(246, 210, 125, 0.45)";
    ctx.strokeRect(16.5, 16.5, 248, 76);

    ctx.fillStyle = "#f6d27d";
    ctx.font = "16px Courier New";
    ctx.fillText("VIDAS", 28, 40);
    ctx.fillText("POS", 28, 66);
    ctx.fillText(worldState.mode === "circuit" ? "TIME" : "PTS", 28, 90);
    ctx.fillText(`LVL ${worldState.level}/${MAX_LEVELS}`, 146, 40);

    for (let i = 0; i < 3; i += 1) {
      const x = 94 + i * 28;
      ctx.fillStyle = i < player.lives ? "#ff587b" : "#39263d";
      ctx.fillRect(x, 28, 18, 16);
      ctx.fillStyle = i < player.lives ? "#ffd0d7" : "#71536e";
      ctx.fillRect(x + 3, 31, 12, 10);
    }

    ctx.fillStyle = "#d2dbef";
    ctx.fillText(`${Math.floor(player.body.position.x)}m`, 94, 66);
    ctx.fillText(worldState.mode === "circuit" ? formatTime(levelTimerFrames) : `${player.score}`, 94, 90);
    ctx.fillText(worldState.mode === "circuit" ? "RUSH" : `HI ${player.highScore}`, 146, 90);
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

  function startGame(difficultyKey) {
    worldState.difficulty = GameWorld.getDifficultyConfig(difficultyKey);
    writeStoredString(STORAGE_KEYS.difficulty, worldState.difficulty.key);
    gameStarted = true;
    pendingLevelAdvance = 0;
    levelTimerFrames = 0;
    mainMenu.classList.add("hidden");
    mainMenu.setAttribute("aria-hidden", "true");
    restartAtLevel(1, `Dificultad ${worldState.difficulty.label}. Operacion iniciada.`);
  }

  function setCharacter(characterKey) {
    GamePlayer.setCharacter(player, characterKey);
    writeStoredString(STORAGE_KEYS.character, player.character);
    updateCharacterUi();
    if (gameStarted) {
      restartAtLevel(worldState.level, `${player.characterName} desplegado en campo.`);
    }
  }

  function setMode(modeKey) {
    worldState.mode = modeKey === "circuit" ? "circuit" : "standard";
    writeStoredString(STORAGE_KEYS.mode, worldState.mode);
    if (gameStarted) {
      restartAtLevel(1, worldState.mode === "circuit"
        ? "Modo circuito cargado. La prioridad es completar rapido el nivel."
        : "Modo estandar cargado. La prioridad es sumar puntos y llegar a meta.");
    }
  }

  function setSkin(skinKey) {
    worldState.skin = GameWorld.getSkinConfig(skinKey);
    writeStoredString(STORAGE_KEYS.skin, worldState.skin.key);
    if (gameStarted) {
      restartAtLevel(worldState.level, `Skin ${worldState.skin.label} aplicada.`);
    }
  }

  function exportBoardConfig() {
    const data = GameWorld.exportBoard(worldState);
    boardJson.value = JSON.stringify(data, null, 2);
    overlay.message = "Configuracion exportada a JSON.";
    overlay.timer = 160;
  }

  function importBoardConfig() {
    if (!boardJson.value.trim()) {
      return;
    }

    try {
      const config = JSON.parse(boardJson.value);
      GameWorld.importBoard(engine, worldState, config);
      GamePlayer.setSpawn(player, worldState.spawn);
      GamePlayer.resetPlayer(player);
      gameStarted = true;
      pendingLevelAdvance = 0;
      mainMenu.classList.add("hidden");
      mainMenu.setAttribute("aria-hidden", "true");
      camera.x = 0;
      camera.y = 0;
      overlay.message = "Tablero importado correctamente.";
      overlay.timer = 180;
    } catch (error) {
      overlay.message = "JSON invalido. Revisa la configuracion importada.";
      overlay.timer = 180;
    }
  }

  function writeStoredString(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Ignore persistence failures.
    }
  }

  function loadStoredBoardPrefs() {
    worldState.mode = readStoredString(STORAGE_KEYS.mode, "standard");
    worldState.skin = GameWorld.getSkinConfig(readStoredString(STORAGE_KEYS.skin, "neon"));
  }

  function loadStoredCharacter(targetPlayer) {
    GamePlayer.setCharacter(targetPlayer, readStoredString(STORAGE_KEYS.character, "ronin"));
    updateCharacterUi();
  }

  function updateCharacterUi() {
    currentCharacterLabel.textContent = player.characterName;
    characterButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.character === player.character);
    });
  }

  function readStoredString(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function loadStoredScore(targetPlayer) {
    const score = readStoredNumber(STORAGE_KEYS.score);
    const highScore = readStoredNumber(STORAGE_KEYS.highScore);
    targetPlayer.score = score;
    targetPlayer.highScore = Math.max(score, highScore);
  }

  function syncStoredScore() {
    player.highScore = Math.max(player.highScore, player.score);

    if (player.score !== lastStoredScore) {
      writeStoredNumber(STORAGE_KEYS.score, player.score);
      lastStoredScore = player.score;
    }

    if (player.highScore !== lastStoredHighScore) {
      writeStoredNumber(STORAGE_KEYS.highScore, player.highScore);
      lastStoredHighScore = player.highScore;
    }
  }

  function readStoredNumber(key) {
    try {
      const raw = window.localStorage.getItem(key);
      const value = raw === null ? 0 : Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function writeStoredNumber(key, value) {
    try {
      window.localStorage.setItem(key, String(Math.max(0, Math.floor(value))));
    } catch (error) {
      // localStorage can fail in private contexts; gameplay should continue.
    }
  }

  function formatTime(frameCount) {
    const totalSeconds = frameCount / 60;
    return `${totalSeconds.toFixed(2)}s`;
  }

  overlay.message = "El viento helado del ronin ya esta en marcha.";
  overlay.timer = 160;
  syncStoredScore();
  loop();
}());
