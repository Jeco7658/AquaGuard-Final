const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const gameOverScreen = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Game State 
let score = 0;
let gameTime = 60;
let isGameOver = false;
let gameStarted = false;
let isGamePaused = false;
let animationFrameId = null;  // track the current loop for cleanup
const keys = {};
const mouse = { x: 0, y: 0, clicked: false }; // Added clicked state
const mobileControls = document.getElementById('mobile-controls');
const trashItems = [];
const obstacles = [];
let obstacleHitCooldown = 0;
let trashAssetHitCooldown = 0;

// Volume Control
let musicVolume = 0.3;
let sfxVolume = 0.7;

const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Mobile sprite scaling - reduce sprite sizes on mobile for better gameplay
const mobileScaleFactor = isTouchDevice && window.innerWidth <= 768 ? 0.45 : 1;
const mobileBoatScale = isTouchDevice && window.innerWidth <= 768 ? 0.15 : 0.25;

function setMobileControlsVisible(visible) {
    if (!mobileControls) return;
    const shouldShow = visible && isTouchDevice;
    mobileControls.classList.toggle('hidden', !shouldShow);
}

function releaseMovementKeys() {
    keys['KeyW'] = false;
    keys['KeyA'] = false;
    keys['KeyS'] = false;
    keys['KeyD'] = false;
}

const boat = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    // dimensions will be filled once the frames load
    w: 0, h: 0,
    // scaling factor applied when drawing (1 = original size)
    scale: mobileBoatScale,
    angle: 0,
    speed: 0,
    // movement parameters (lower values = slower movement)
    maxSpeed: 3,
    accel: 0.1,
    friction: 0.97,
    // animation state
    frame: 0,
    frameCount: 0,
    frameTimer: 0,
    frameInterval: 20,    // ticks between frames when moving
    idleInterval: 30,     // ticks between frames when idle (slower)
    // transition/fade state
    isTransitioning: false,
    transitionTimer: 0, // counts frames during transition
    transitionDuration: 30,  // default duration frames to fade between state (increase for slower fade)
    toMovementDuration: 125,  // slower fade into movement
    toIdleDuration: 30,      // slower fade into idle
    oldFrames: null,
    oldFrame: 0 // to track old frame index during transition
};

const claw = {
    x: 0, y: 0,
    length: 0,
    maxLength: isTouchDevice && window.innerWidth <= 768 ? 135 : 300,
    speed: isTouchDevice && window.innerWidth <= 768 ? 7.2 : 16,
    state: 'idle', // 'idle', 'extending', 'retracting'
    // offset from boat center where claw originates (adjust to move where it comes from)
    offsetForward: isTouchDevice && window.innerWidth <= 768 ? 22.5 : 50,  // how far ahead/above the boat to start extending
    offsetSide: 0       // side offset (positive = right, negative = left)
};

function getClawBaseOffset() {
    if (isTouchDevice && window.innerWidth <= 768) {
        // Keep claw start point under the smaller mobile boat sprite.
        return {
            forward: Math.max(30, boat.h * 0.45),
            side: claw.offsetSide,
        };
    }

    return {
        forward: claw.offsetForward,
        side: claw.offsetSide,
    };
}

// Sound Effects
const sounds = {
    catch: new Audio('sfx/Tap_82(mp3cut.net).mp3'),
    collision: new Audio('sfx/03_crate_open_1.wav'),
    gameOver: new Audio('sfx/Text 1.wav'),
    trash_hit: new Audio('sfx/Modern10.ogg'),
    buttonClick: new Audio('sfx/Modern6.ogg')
};

// Background Music
const bgMusic = new Audio('sfx/Sweeping Waves.mp3');
bgMusic.loop = true;

// Initialize sound volumes
function initSoundVolume(volume = 0.6) {
    Object.values(sounds).forEach(sound => {
        sound.volume = Math.max(0, Math.min(1, sfxVolume));
    });
    bgMusic.volume = Math.max(0, Math.min(1, musicVolume));
}

function setMusicVolume(val) {
    musicVolume = Math.max(0, Math.min(1, val / 100));
    bgMusic.volume = musicVolume;
}

function setSFXVolume(val) {
    sfxVolume = Math.max(0, Math.min(1, val / 100));
    Object.values(sounds).forEach(sound => {
        sound.volume = sfxVolume;
    });
}

function setVolume(val) {
    const volume = val / 100;
    musicVolume = volume * 0.3;
    sfxVolume = volume * 0.7;
    initSoundVolume(volume);
}

initSoundVolume();


// Assets
// boat animation frames separated by state
const boatMoveFrames = [];
const boatIdleFrames = [];
const boatMovePaths = [
    'boat/boat_move1.png',
    'boat/boat_move2.png',
    'boat/boat_move3.png',
    'boat/boat_move4.png'
];
const boatIdlePaths = [
    'boat/boat_still.png'
];

function loadFrameSet(paths, targetArray) {
    paths.forEach(path => {
        const img = new Image();
        img.src = path;
        img.onload = () => {
            if (boat.w === 0 && boat.h === 0) {
                boat.w = img.width * boat.scale;
                boat.h = img.height * boat.scale;
            }
        };
        targetArray.push(img);
    });
}

loadFrameSet(boatMovePaths, boatMoveFrames);
loadFrameSet(boatIdlePaths, boatIdleFrames);

// use idle frames at start
boat.currentFrames = boatIdleFrames;
boat.frameCount = boat.currentFrames.length;

// list of trash images; add as many objects as you like with a src and optional size
// list of trash images; add as many objects as you like with a src and optional size
const trashAssets = [
    { src: 'trash_assets/water_bottle_float.png', size: 50 },
    { src: 'trash_assets/empty_bottle_float.png', size: 60  },
    { src: 'trash_assets/can2.png', size: 30  },
    { src: 'trash_assets/plastic_bag.png', size: 30  },
];

// load each image object
trashAssets.forEach(asset => {
    asset.img = new Image();
    asset.img.src = asset.src;
});

// Obstacle assets
const obstacleAssets = [
    { src: 'obstacle/small_rock.png', size: 40 },
    { src: 'obstacle/medium_rock.png', size: 50 },
    { src: 'obstacle/big_rock.png', size: 120 },
];

// load each obstacle image
obstacleAssets.forEach(asset => {
    asset.img = new Image();
    asset.img.src = asset.src;
});

const oceanBackground = new Image();
oceanBackground.src = 'assets/Ocean.jpg';

// // Watermark overlay
// const watermarkImg = new Image();
// watermarkImg.src = 'assets/controls_white_2.png';

// // TRASH_SIZE is now a fallback in case an asset doesn't specify its own size
// const TRASH_SIZE = 100; // base size of trash in pixels (increase to make them bigger)

// --- Classes ---
class Obstacle {
    constructor() {
        this.reset();
    }
    reset() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        // pick a random asset index based on array length
        this.type = Math.floor(Math.random() * obstacleAssets.length);
        // size either comes from the asset definition or fallback
        this.size = obstacleAssets[this.type].size || 50;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        const size = this.size * mobileScaleFactor;
        const asset = obstacleAssets[this.type];
        // draw the appropriate image centered on the obstacle position
        ctx.drawImage(asset.img, -size/2, -size/2, size, size);
        ctx.restore();
    }
}

class Trash {
    constructor() {
        this.reset();
    }
    reset() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        // pick a random asset index based on array length
        this.type = Math.floor(Math.random() * trashAssets.length);
        // size either comes from the asset definition or fallback to TRASH_SIZE
        this.size = trashAssets[this.type].size || TRASH_SIZE;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        const size = this.size * mobileScaleFactor;
        const asset = trashAssets[this.type];
        // draw the appropriate image centered on the trash position
        ctx.drawImage(asset.img, -size/2, -size/2, size, size);
        ctx.restore();
    }
}

function placeNonOverlapping(item, others, padding = 10) {
    for (let tries = 0; tries < 50; tries++) {
        item.x = Math.random() * canvas.width;
        item.y = Math.random() * canvas.height;
        let ok = true;
        const boatSafeRadius = Math.max(boat.w, boat.h) * 0.6; // safe radius around boat to prevent spawning too close
        if (Math.hypot(item.x - boat.x, item.y - boat.y) < boatSafeRadius) {
            ok = false;
        }
        for (const other of others) {
            const otherSize = other.size || 0;
            const minDist = (item.size + otherSize) / 2 + padding;
            if (Math.hypot(item.x - other.x, item.y - other.y) < minDist) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
}

function respawnTrash(t) {
    t.reset();
    const others = trashItems.filter(item => item !== t).concat(obstacles);
    placeNonOverlapping(t, others, 10);
}

// Input Handling 
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

const movementButtons = document.querySelectorAll('#mobile-dpad [data-key]');
movementButtons.forEach(button => {
    const keyCode = button.dataset.key;
    const press = (e) => {
        e.preventDefault();
        keys[keyCode] = true;
    };
    const release = (e) => {
        e.preventDefault();
        keys[keyCode] = false;
    };

    button.addEventListener('touchstart', press, { passive: false });
    button.addEventListener('touchend', release, { passive: false });
    button.addEventListener('touchcancel', release, { passive: false });
});

const mobileGrabButton = document.getElementById('mobile-grab');
if (mobileGrabButton) {
    mobileGrabButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (gameStarted && !isGameOver && claw.state === 'idle') {
            claw.state = 'extending';
        }
    }, { passive: false });
}

window.addEventListener('blur', releaseMovementKeys);

window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// Click Listener for Claw
window.addEventListener('mousedown', () => {
    if (claw.state === 'idle') {
        claw.state = 'extending';
    }
});

// Space Key Listener for Claw
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault(); // prevent page scroll
        if (claw.state === 'idle') {
            claw.state = 'extending';
        }
    }
});

// MOBILE/TOUCH SUPPORT 
// Handle touch cursor position (for mobile)
window.addEventListener('touchmove', (e) => {
    if (gameStarted && !isGameOver) {
        const touch = e.touches[0];
        mouse.x = touch.clientX;
        mouse.y = touch.clientY;
        e.preventDefault();
    }
});

// Handle touch claw trigger
window.addEventListener('touchstart', (e) => {
    if (e.target.closest('#mobile-controls')) return;
    if (gameStarted && !isGameOver && claw.state === 'idle') {
        claw.state = 'extending';
    }
});

// Handle canvas resize for responsive design
window.addEventListener('resize', () => {
    if (!gameStarted && !isGameOver) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
});

// Prevent default touch behaviors
document.addEventListener('touchmove', (e) => {
    if (gameStarted && !isGameOver) {
        e.preventDefault();
    }
}, { passive: false });

// Core Logic 
// Helper function: Check if a circle collides with the boat's rotated rectangle
function checkBoatCircleCollision(circleX, circleY, circleRadius, hitboxScale = 0.9, backScale = 0.4) {
    // Translate circle to boat's local coordinate system
    const dx = circleX - boat.x;
    const dy = circleY - boat.y;
    
    // Rotate the circle position to align with boat's orientation (reverse rotation)
    const localX = dx * Math.cos(-boat.angle) - dy * Math.sin(-boat.angle);
    const localY = dx * Math.sin(-boat.angle) + dy * Math.cos(-boat.angle);
    
    // Find the closest point on the boat rectangle to the circle center
    const halfWidth = (boat.w * hitboxScale) / 2;
    const halfHeight = (boat.h * hitboxScale) / 2;
    const backHalfHeight = halfHeight * backScale;
    const closestX = Math.max(-halfWidth, Math.min(halfWidth, localX));
    // localY < 0 is the boat's front; localY > 0 is the back
    const limitY = localY < 0 ? halfHeight : backHalfHeight;
    const closestY = Math.max(-limitY, Math.min(limitY, localY));
    
    // Calculate distance from circle center to closest point
    const distX = localX - closestX;
    const distY = localY - closestY;
    const distSquared = distX * distX + distY * distY;
    
    // Check if distance is less than circle radius
    return distSquared < (circleRadius * circleRadius);
}

function update() {
    if (isGameOver || isGamePaused) return;

    // // 1. Rotation (Faces Cursor)
    // const dx = mouse.x - boat.x;
    // const dy = mouse.y - boat.y;
    // boat.angle = Math.atan2(dy, dx) + Math.PI/2;

    // 1. Rotation with A/D Keys
    const rotationSpeed = 0.02;  // lower value = slower rotation
    if (keys['KeyA']) boat.angle -= rotationSpeed;
    if (keys['KeyD']) boat.angle += rotationSpeed;

    // 2. Movement (W Key)
    if (keys['KeyW']) boat.speed += boat.accel;
    if (keys['KeyS']) boat.speed -= boat.accel;

    boat.speed *= boat.friction;
    
    // Store old position for collision rollback
    const oldBoatX = boat.x;
    const oldBoatY = boat.y;
    
    // Move boat
    boat.x += Math.sin(boat.angle) * boat.speed;
    boat.y -= Math.cos(boat.angle) * boat.speed;

    // 3. Collision Detection with Obstacles (prevent passing through + penalty)
    obstacles.forEach(obs => {
        // Collision radius is half the image size (obs.size / 4 since radius is half of diameter)
        const collisionRadius = (obs.size * mobileScaleFactor) / 4;
        
        if (checkBoatCircleCollision(obs.x, obs.y, collisionRadius, 0.9)) {
            // Collision! Revert to old position
            boat.x = oldBoatX;
            boat.y = oldBoatY;
            
            // Apply penalty based on obstacle size
            if (obstacleHitCooldown <= 0) {
                if (obs.size <= 40) {
                    // Small rock: -1 trashes
                    score = Math.max(0, score - 1);
                } else if (obs.size <= 50) {
                    // Medium rock: -2 trashes
                    score = Math.max(0, score - 2);
                } else {
                    // Big rock: -3 trashes
                    score = Math.max(0, score - 3);
                }
                scoreElement.innerText = score;
                sounds.collision.currentTime = 0;
                sounds.collision.play().catch(() => {});
                obstacleHitCooldown = 120;  // cooldown 120 frames = 2 seconds
            }
        }
    });

    // determine which frame set we're using (moving vs idle)
    const moving = boat.speed > 0.1;
    const desiredSet = moving ? boatMoveFrames : boatIdleFrames;
    if (boat.currentFrames !== desiredSet) {
        boat.oldFrames = boat.currentFrames;
        boat.oldFrame = boat.frame;
        boat.currentFrames = desiredSet;
        boat.frameCount = boat.currentFrames.length;
        // clamp frame to valid range for new set
        if (boat.frame >= boat.frameCount) {
            boat.frame = 0;
        }
        boat.isTransitioning = true;
        boat.transitionTimer = 0; // reset transition timer
        // use appropriate duration based on direction
        boat.transitionDuration = moving ? boat.toMovementDuration : boat.toIdleDuration; // set duration based on transition type
    }

    // increment transition counter
    if (boat.isTransitioning) {
        boat.transitionTimer++;
        if (boat.transitionTimer >= boat.transitionDuration) {
            boat.isTransitioning = false;
            boat.oldFrames = null;
        }
    }

    // animate the selected frames
    if (boat.frameCount > 0) {
        boat.frameTimer++;
        const interval = moving ? boat.frameInterval : boat.idleInterval;
        if (boat.frameTimer >= interval) {
            boat.frameTimer = 0;
            boat.frame = (boat.frame + 1) % boat.frameCount;
        }
    }

    // 3. Boundary Wrap
    if (boat.x < 0) boat.x = canvas.width;
    if (boat.x > canvas.width) boat.x = 0;
    if (boat.y < 0) boat.y = canvas.height;
    if (boat.y > canvas.height) boat.y = 0;

    // 4. Claw Logic (Triggered by MouseDown)
    if (claw.state === 'extending') {
        claw.length += claw.speed;
        if (claw.length >= claw.maxLength) claw.state = 'retracting';
    } else if (claw.state === 'retracting') {
        claw.length -= claw.speed;
        if (claw.length <= 0) {
            claw.length = 0;
            claw.state = 'idle';
        }
    }

    // Update tip position based on current boat angle
    const clawBaseOffset = getClawBaseOffset();
    const clawBaseX = boat.x + Math.sin(boat.angle) * clawBaseOffset.forward - Math.cos(boat.angle) * clawBaseOffset.side;
    const clawBaseY = boat.y - Math.cos(boat.angle) * clawBaseOffset.forward - Math.sin(boat.angle) * clawBaseOffset.side;
    claw.x = clawBaseX + Math.sin(boat.angle) * claw.length;
    claw.y = clawBaseY - Math.cos(boat.angle) * claw.length;

    // // Update tip position based on current boat angle
    // claw.x = boat.x + Math.sin(boat.angle) * (boat.h/2 + claw.length);
    // claw.y = boat.y - Math.cos(boat.angle) * (boat.h/2 + claw.length);

    // 5. Collision Detection with Trash (Claw)
    trashItems.forEach(t => {
        const dist = Math.hypot(claw.x - t.x, claw.y - t.y);
        const catchDistance = isTouchDevice && window.innerWidth <= 768 ? 11.25 : 25;
        // Only catch if the claw is active and close to trash
        if (dist < catchDistance && claw.state !== 'idle') {
            respawnTrash(t);
            score++;
            scoreElement.innerText = score;
            sounds.catch.currentTime = 0;
            sounds.catch.play().catch(() => {});
            // Instantly start retracting once something is caught
            claw.state = 'retracting';
        }
    });

    // 6. Collision Detection with Trash Items (Boat) - Penalty & Disappear
    for (let i = trashItems.length - 1; i >= 0; i--) {
        const t = trashItems[i];
        
        if (checkBoatCircleCollision(t.x, t.y, (t.size * mobileScaleFactor) / 2, 0.9)) {
            // Apply penalty every 2 seconds while touching trash
            if (trashAssetHitCooldown <= 0) {
                // Deduct 1 second from time when hitting trash
                gameTime = Math.max(0, gameTime - 1);
                timerElement.innerText = gameTime;
                sounds.trash_hit.currentTime = 0;
                sounds.trash_hit.play().catch(() => {});
                trashAssetHitCooldown = 120;  // 120 frames = 2 seconds before next penalty
            }
            // Remove the trash item
            trashItems.splice(i, 1);
        }
    }

    // Decrement cooldown timers
    if (obstacleHitCooldown > 0) obstacleHitCooldown--;
    if (trashAssetHitCooldown > 0) trashAssetHitCooldown--;
}

function draw() {
    if (oceanBackground.complete && oceanBackground.naturalWidth > 0) {
        const canvasAspect = canvas.width / canvas.height;
        const imageAspect = oceanBackground.naturalWidth / oceanBackground.naturalHeight;

        let drawWidth;
        let drawHeight;
        let drawX;
        let drawY;

        if (imageAspect > canvasAspect) {
            drawHeight = canvas.height;
            drawWidth = drawHeight * imageAspect;
            drawX = (canvas.width - drawWidth) / 2;
            drawY = 0;
        } else {
            drawWidth = canvas.width;
            drawHeight = drawWidth / imageAspect;
            drawX = 0;
            drawY = (canvas.height - drawHeight) / 2;
        }

        ctx.drawImage(oceanBackground, drawX, drawY, drawWidth, drawHeight);
    } else {
        // ctx.fillStyle = '#0077be';
        // ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw obstacles
    obstacles.forEach(obs => obs.draw());

    // Draw trash items
    trashItems.forEach(t => t.draw());

    // Draw Boat (using individual frame images)
    ctx.save();
    ctx.translate(boat.x, boat.y);
    ctx.rotate(boat.angle);
    
    if (boat.currentFrames && boat.frameCount > 0) {
        if (boat.isTransitioning && boat.oldFrames && boat.oldFrames.length > 0) {
            // fade between old and new frames
            const progress = boat.transitionTimer / boat.transitionDuration;
            const oldOpacity = 1 - progress;
            const newOpacity = progress;
            
            // draw old frame fading out
            if (boat.oldFrame < boat.oldFrames.length) {
                ctx.globalAlpha = oldOpacity;
                const oldImg = boat.oldFrames[boat.oldFrame];
                ctx.drawImage(oldImg, -boat.w/2, -boat.h/2, boat.w, boat.h);
            }
            
            // draw new frame fading in
            ctx.globalAlpha = newOpacity;
            const img = boat.currentFrames[boat.frame];
            ctx.drawImage(img, -boat.w/2, -boat.h/2, boat.w, boat.h);
            ctx.globalAlpha = 1;
        } else {
            // normal drawing when not transitioning
            const img = boat.currentFrames[boat.frame];
            ctx.drawImage(img, -boat.w/2, -boat.h/2, boat.w, boat.h);
        }
    } else {
        // fallback triangle while images load or if missing
        ctx.fillStyle = '#d2b48c'; 
        ctx.beginPath();
        ctx.moveTo(0, -40); 
        ctx.lineTo(20, 40);
        ctx.lineTo(-20, 40);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();

    // Draw Claw (after boat so it appears on top)
    if (claw.length > 0) {
        // calculate claw base position
        const clawBaseOffset = getClawBaseOffset();
        const clawBaseX = boat.x + Math.sin(boat.angle) * clawBaseOffset.forward - Math.cos(boat.angle) * clawBaseOffset.side;
        const clawBaseY = boat.y - Math.cos(boat.angle) * clawBaseOffset.forward - Math.sin(boat.angle) * clawBaseOffset.side;
        
        const clawSize = isTouchDevice && window.innerWidth <= 768 ? 7.2 : 16;
        const lineWidth = isTouchDevice && window.innerWidth <= 768 ? 1 : 2;
        
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(clawBaseX, clawBaseY);
        ctx.lineTo(claw.x, claw.y);
        ctx.stroke();
        
        ctx.fillStyle = '#000000';
        ctx.fillRect(claw.x - clawSize/2, claw.y - clawSize/2, clawSize, clawSize);
    }
    
    // // Draw watermark 
    // if (watermarkImg.complete && watermarkImg.width > 0) {
    //     ctx.globalAlpha = 0.3;
    //     const watermarkWidth = watermarkImg.width * 0.3;  // 50% of original size
    //     const watermarkHeight = watermarkImg.height * 0.3; // maintain aspect ratio
    //     ctx.drawImage(watermarkImg, canvas.width - watermarkWidth - 800, canvas.height - watermarkHeight - 100, watermarkWidth, watermarkHeight);
    //     ctx.globalAlpha = 1;
    // }
}

// --- Start / Initialize (called when Play is pressed) ---
let gameTimerInterval = null;
function startGame() {
    // cancel any existing loop
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (gameTimerInterval) clearInterval(gameTimerInterval);
    
    // reset game state
    score = 0;
    gameTime = 60;
    isGameOver = false;
    gameStarted = true;
    scoreElement.innerText = score;
    timerElement.innerText = gameTime;
    gameOverScreen.classList.add('hidden');

    // reset boat position and state
    boat.x = canvas.width / 2;
    boat.y = canvas.height / 2;
    boat.angle = 0;
    boat.speed = 0;
    boat.frame = 0;
    boat.frameTimer = 0;
    boat.isTransitioning = false;
    boat.transitionTimer = 0;
    boat.currentFrames = boatIdleFrames;
    boat.frameCount = boat.currentFrames.length;
    
    // reset claw
    claw.state = 'idle';
    claw.length = 0;

    // clear and spawn obstacles
    obstacles.length = 0;
    for (let i = 0; i < 8; i++) {
        const obs = new Obstacle();
        placeNonOverlapping(obs, obstacles, 20);
        obstacles.push(obs);
    }

    // clear and spawn trash
    trashItems.length = 0;
    for (let i = 0; i < 15; i++) {
        const t = new Trash();
        placeNonOverlapping(t, trashItems.concat(obstacles), 10);
        trashItems.push(t);
    }

    // reset cooldowns
    obstacleHitCooldown = 0;
    trashAssetHitCooldown = 0;

    // start timer
    setupGameTimer();

    // hide start menu
    const startMenu = document.getElementById('start-menu');
    if (startMenu) startMenu.classList.add('hidden');
    
    // hide pause screen
    pauseScreen.classList.add('hidden');
    
    // show UI
    const ui = document.getElementById('ui');
    if (ui) ui.classList.remove('hidden');
    setMobileControlsVisible(true);

    // Reset and prepare all audio for clean playback
    Object.values(sounds).forEach(sound => {
        sound.pause();
        sound.currentTime = 0;
    });
    bgMusic.pause();
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => {});
    
    // kick off loop
    animationFrameId = requestAnimationFrame(loop);
}

function loop() {
    if (gameStarted && !isGameOver && !isGamePaused) update();
    draw();
    animationFrameId = requestAnimationFrame(loop);
}

// Pause Screen Functions
const pauseScreen = document.getElementById('pause-screen');
const musicVolumeSlider = document.getElementById('music-volume');
const sfxVolumeSlider = document.getElementById('sfx-volume');

function togglePause() {
    if (!gameStarted || isGameOver) return;
    
    isGamePaused = !isGamePaused;
    
    if (isGamePaused) {
        pauseScreen.classList.remove('hidden');
        // Update sliders to reflect current values
        musicVolumeSlider.value = Math.round(musicVolume * 100);
        sfxVolumeSlider.value = Math.round(sfxVolume * 100);
    } else {
        pauseScreen.classList.add('hidden');
    }
}

function quitToMenu() {
    isGamePaused = false;
    pauseScreen.classList.add('hidden');
    returnToMenu();
}

// Wire up pause screen sliders
if (musicVolumeSlider) {
    musicVolumeSlider.addEventListener('input', (e) => {
        setMusicVolume(parseInt(e.target.value));
    });
}

if (sfxVolumeSlider) {
    sfxVolumeSlider.addEventListener('input', (e) => {
        setSFXVolume(parseInt(e.target.value));
    });
}

// ESC key to pause/unpause
window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        e.preventDefault();
        togglePause();
    }
});

// Mobile pause button
const mobilePauseBtn = document.getElementById('mobile-pause-btn');
if (mobilePauseBtn) {
    mobilePauseBtn.addEventListener('click', function() {
        sounds.buttonClick.currentTime = 0;
        sounds.buttonClick.play().catch(() => {});
        togglePause();
    });
}

// Wire up Play button
const playBtn = document.getElementById('playButton');
if (playBtn) playBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    showStoryScreen();
});

// Wire up story navigation buttons
const storyNextBtn = document.getElementById('storyNextButton');
if (storyNextBtn) storyNextBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    showMissionFromStory();
});

const storyPreviousBtn = document.getElementById('storyPreviousButton');
if (storyPreviousBtn) storyPreviousBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    showStartMenuFromStory();
});

const missionNextBtn = document.getElementById('missionNextButton');
if (missionNextBtn) missionNextBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    showControlsFromMission();
});

const missionPreviousBtn = document.getElementById('missionPreviousButton');
if (missionPreviousBtn) missionPreviousBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    showStoryFromMission();
});

// Wire up Leaderboard button
const leaderboardBtn = document.getElementById('leaderboardButton');
if (leaderboardBtn) leaderboardBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    showLeaderboardScreen();
});

// Wire up Next button (controls screen)
const nextBtn = document.getElementById('nextButton');
if (nextBtn) nextBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    startGameFromControls();
});

// Wire up Previous button (controls screen)
const previousBtn = document.getElementById('previousButton');
if (previousBtn) previousBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    showMissionFromControls();
});

// Wire up Back button (leaderboard)
const backBtn = document.querySelector('.back-button');
if (backBtn) backBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
    hideLeaderboardScreen();
});

// Wire up game-over buttons
const submitScoreBtn = document.querySelector('#game-over button:nth-of-type(1)');
const playAgainBtn = document.querySelector('#game-over button:nth-of-type(2)');
const returnMenuBtn = document.querySelector('#game-over button:nth-of-type(3)');

if (submitScoreBtn) submitScoreBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
});

if (playAgainBtn) playAgainBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
});

if (returnMenuBtn) returnMenuBtn.addEventListener('click', function() {
    sounds.buttonClick.currentTime = 0;
    sounds.buttonClick.play().catch(() => {});
});

function showStoryScreen() {
    const startMenu = document.getElementById('start-menu');
    const storyScreen = document.getElementById('story-screen');
    if (startMenu) startMenu.classList.add('hidden');
    if (storyScreen) storyScreen.classList.remove('hidden');
    setMobileControlsVisible(false);
}

function showMissionFromStory() {
    const storyScreen = document.getElementById('story-screen');
    const missionScreen = document.getElementById('mission-screen');
    if (storyScreen) storyScreen.classList.add('hidden');
    if (missionScreen) missionScreen.classList.remove('hidden');
    setMobileControlsVisible(false);
}

function showStoryFromMission() {
    const storyScreen = document.getElementById('story-screen');
    const missionScreen = document.getElementById('mission-screen');
    if (missionScreen) missionScreen.classList.add('hidden');
    if (storyScreen) storyScreen.classList.remove('hidden');
    setMobileControlsVisible(false);
}

function showControlsFromMission() {
    const missionScreen = document.getElementById('mission-screen');
    const controlsScreen = document.getElementById('controls-screen');
    if (missionScreen) missionScreen.classList.add('hidden');
    if (controlsScreen) controlsScreen.classList.remove('hidden');
    setMobileControlsVisible(false);
}

function showStartMenuFromStory() {
    const startMenu = document.getElementById('start-menu');
    const storyScreen = document.getElementById('story-screen');
    if (storyScreen) storyScreen.classList.add('hidden');
    if (startMenu) startMenu.classList.remove('hidden');
    setMobileControlsVisible(false);
}

function showControlsScreen() {
    const startMenu = document.getElementById('start-menu');
    const controlsScreen = document.getElementById('controls-screen');
    if (startMenu) startMenu.classList.add('hidden');
    if (controlsScreen) controlsScreen.classList.remove('hidden');
    setMobileControlsVisible(false);
}

function startGameFromControls() {
    const controlsScreen = document.getElementById('controls-screen');
    if (controlsScreen) controlsScreen.classList.add('hidden');
    startGame();
}

function showMissionFromControls() {
    const missionScreen = document.getElementById('mission-screen');
    const controlsScreen = document.getElementById('controls-screen');
    if (controlsScreen) controlsScreen.classList.add('hidden');
    if (missionScreen) missionScreen.classList.remove('hidden');
    setMobileControlsVisible(false);
}

function showStartMenuFromControls() {
    const startMenu = document.getElementById('start-menu');
    const controlsScreen = document.getElementById('controls-screen');
    if (controlsScreen) controlsScreen.classList.add('hidden');
    if (startMenu) startMenu.classList.remove('hidden');
    bgMusic.pause();
    bgMusic.currentTime = 0;
    setMobileControlsVisible(false);
}

function returnToMenu() {
    // hide game-over and show menu
    gameOverScreen.classList.add('hidden');
    pauseScreen.classList.add('hidden');
    const storyScreen = document.getElementById('story-screen');
    if (storyScreen) storyScreen.classList.add('hidden');
    const missionScreen = document.getElementById('mission-screen');
    if (missionScreen) missionScreen.classList.add('hidden');
    const controlsScreen = document.getElementById('controls-screen');
    if (controlsScreen) controlsScreen.classList.add('hidden');
    // hide UI
    const ui = document.getElementById('ui');
    if (ui) ui.classList.add('hidden');
    setMobileControlsVisible(false);
    releaseMovementKeys();
    // Stop background music on start menu
    bgMusic.pause();
    bgMusic.currentTime = 0;
    // reset game state
    isGameOver = false;
    gameStarted = false;
    isGamePaused = false;
    if (gameTimerInterval) clearInterval(gameTimerInterval);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    // clear canvas and trash
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    trashItems.length = 0;
    obstacles.length = 0;
    // show start menu
    const startMenu = document.getElementById('start-menu');
    if (startMenu) startMenu.classList.remove('hidden');
}

// LEADERBOARD

const LEADERBOARD_API = 'https://api.simpleboards.dev/api/entries';
const LEADERBOARD_ID = '5fca5972-53d2-49b3-73ac-08de7541d465';
const API_KEY = 'ade48cad-2cbf-4478-9ff1-52b9945f6c53';

function generatePlayerId() {
    // Generate a unique ID for each submission
    return 'player_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

async function submitScore() {
    const nameInput = document.getElementById('player-name');
    const statusDiv = document.getElementById('leaderboard-status');
    const name = nameInput.value.trim();
    
    if (!name) {
        statusDiv.textContent = 'Please enter your name!';
        return;
    }
    
    statusDiv.textContent = 'Submitting...';
    
    try {
        const payload = {
            leaderboardId: LEADERBOARD_ID,
            playerId: generatePlayerId(),
            playerDisplayName: name,
            score: score,
            metadata: 'aquaguard-game'
        };
        
        console.log('Submitting score:', payload);
        
        const response = await fetch(LEADERBOARD_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            },
            body: JSON.stringify(payload)
        });
        
        console.log('Submit response status:', response.status);
        const responseData = await response.json();
        console.log('Submit response data:', responseData);
        
        if (response.ok) {
            statusDiv.textContent = 'Score submitted!';
            nameInput.value = '';
            loadLeaderboard();
        } else {
            statusDiv.textContent = 'Failed to submit score: ' + (responseData.message || response.statusText);
        }
    } catch (error) {
        console.error('Submit error:', error);
        statusDiv.textContent = 'Error: ' + error.message;
    }
}

async function loadLeaderboard() {
    try {
        const response = await fetch(
            `https://api.simpleboards.dev/api/leaderboards/${LEADERBOARD_ID}/entries`,
            {
                headers: {
                    'x-api-key': API_KEY
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            console.log('Game-over Leaderboard API Response:', data);
            // Handle both possible response structures
            const entries = Array.isArray(data) ? data : (data.entries || data.data || []);
            renderLeaderboard(entries);
        } else {
            console.error('Leaderboard API error:', response.status);
        }
    } catch (error) {
        console.error('Failed to load leaderboard:', error);
    }
}

function renderLeaderboard(entries) {
    // const listElement = document.getElementById('leaderboard-list');
    // listElement.innerHTML = '';
    
    // Sort by score descending and take top 10
    const topEntries = entries
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    
    topEntries.forEach((entry, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>#${index + 1} ${entry.playerDisplayName}</span>
            <span>${entry.score} trash</span>
        `;
        listElement.appendChild(li);
    });
}

// GAME TIMER

function setupGameTimer() {
    gameTimerInterval = setInterval(() => {
        // Only decrement timer if game is not paused
        if (!isGamePaused) {
            if (gameTime > 0) {
                gameTime--;
                timerElement.innerText = gameTime;
            }
        }
        // Check for game over (but allow this check even when paused)
        if (gameTime <= 0 && gameStarted && !isGameOver) {
            isGameOver = true;
            gameStarted = false;
            isGamePaused = false;
            pauseScreen.classList.add('hidden');
            const ui = document.getElementById('ui');
            if (ui) ui.classList.add('hidden');
            setMobileControlsVisible(false);
            releaseMovementKeys();
            gameOverScreen.classList.remove('hidden');
            finalScoreElement.innerText = score;
            clearInterval(gameTimerInterval);
            // Stop background music and play game over sound
            bgMusic.pause();
            sounds.gameOver.currentTime = 0;
            sounds.gameOver.play().catch(() => {});
            loadLeaderboard(); // Load leaderboard when game ends
        }
    }, 1000);
}

// LEADERBOARD SCREEN

function showLeaderboardScreen() {
    const startMenu = document.getElementById('start-menu');
    const leaderboardScreen = document.getElementById('leaderboard-screen');
    if (startMenu) startMenu.classList.add('hidden');
    if (leaderboardScreen) leaderboardScreen.classList.remove('hidden');
    loadLeaderboardScreen();
}

function hideLeaderboardScreen() {
    const startMenu = document.getElementById('start-menu');
    const leaderboardScreen = document.getElementById('leaderboard-screen');
    if (leaderboardScreen) leaderboardScreen.classList.add('hidden');
    if (startMenu) startMenu.classList.remove('hidden');
}

async function loadLeaderboardScreen() {
    try {
        const response = await fetch(
            `https://api.simpleboards.dev/api/leaderboards/${LEADERBOARD_ID}/entries`,
            {
                headers: {
                    'x-api-key': API_KEY
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            console.log('Leaderboard API Response:', data);
            // Handle both possible response structures
            const entries = Array.isArray(data) ? data : (data.entries || data.data || []);
            renderLeaderboardScreen(entries);
        } else {
            console.error('Leaderboard API error:', response.status, response.statusText);
            renderLeaderboardScreen([]);
        }
    } catch (error) {
        console.error('Failed to load leaderboard:', error);
        renderLeaderboardScreen([]);
    }
}

function renderLeaderboardScreen(entries) {
    const rowsContainer = document.getElementById('leaderboard-rows');
    rowsContainer.innerHTML = '';
    
    // Sort by score descending
    const sortedEntries = entries.sort((a, b) => b.score - a.score);
    
    // Always show 10 rows
    for (let i = 0; i < 10; i++) {
        const entry = sortedEntries[i];
        const row = document.createElement('div');
        row.className = 'leaderboard-row';
        
        if (entry) {
            row.innerHTML = `
                <span class="row-rank">${i + 1}.</span>
                <span class="row-username">${entry.playerDisplayName}</span>
                <span class="row-collected">${entry.score}</span>
            `;
        } else {
            row.innerHTML = `
                <span class="row-rank">${i + 1}.</span>
                <span class="row-username"></span>
                <span class="row-collected"></span>
            `;
        }
        
        rowsContainer.appendChild(row);
    }
}

// === INITIALIZE BACKGROUND MUSIC ON PAGE LOAD ===
window.addEventListener('load', function () {
    bgMusic.pause();
    bgMusic.currentTime = 0;
});




// const canvas = document.getElementById('gameCanvas');
// const ctx = canvas.getContext('2d');
// const scoreElement = document.getElementById('score');

// canvas.width = window.innerWidth;
// canvas.height = window.innerHeight;

// let score = 0;

// const boat = {
//     x: canvas.width / 2,
//     y: canvas.height - 120,
//     w: 50,
//     h: 90,
//     speed: 0,
//     maxSpeed: 7,
//     acceleration: 0.4,
//     friction: 0.95,
//     angle: 0
// };

// const trashItems = [];
// const keys = {};
// let waveOffset = 0;

// // =======================
// // TRASH SYSTEM
// // =======================

// function spawnTrash() {
//     trashItems.push({
//         x: Math.random() * (canvas.width - 30),
//         y: -40,
//         size: 15 + Math.random() * 20,
//         speed: 2 + Math.random() * (2 + score * 0.05)
//     });
// }

// setInterval(spawnTrash, 1000);

// // =======================
// // UPDATE FUNCTIONS
// // =======================

// function updateBoat() {

//     // Move LEFT (A)
//     if (keys['KeyA']) {
//         boat.speed -= boat.acceleration;
//         boat.angle = -0.2;
//     }

//     // Move RIGHT (D)
//     if (keys['KeyD']) {
//         boat.speed += boat.acceleration;
//         boat.angle = 0.2;
//     }

//     boat.speed *= boat.friction;

//     if (boat.speed > boat.maxSpeed) boat.speed = boat.maxSpeed;
//     if (boat.speed < -boat.maxSpeed) boat.speed = -boat.maxSpeed;

//     boat.x += boat.speed;

//     // Smooth reset tilt when not pressing
//     if (!keys['KeyA'] && !keys['KeyD']) {
//         boat.angle *= 0.9;
//     }

//     // Keep inside screen
//     if (boat.x < 0) boat.x = 0;
//     if (boat.x > canvas.width - boat.w)
//         boat.x = canvas.width - boat.w;
// }

// function updateTrash() {
//     for (let i = trashItems.length - 1; i >= 0; i--) {
//         let t = trashItems[i];
//         t.y += t.speed;

//         // Collision
//         if (t.x < boat.x + boat.w &&
//             t.x + t.size > boat.x &&
//             t.y < boat.y + boat.h &&
//             t.y + t.size > boat.y) {

//             trashItems.splice(i, 1);
//             score++;
//             scoreElement.innerText = score;
//         }

//         if (t.y > canvas.height) {
//             trashItems.splice(i, 1);
//         }
//     }
// }

// // =======================
// // DRAW FUNCTIONS
// // =======================

// function drawOcean() {
//     ctx.clearRect(0, 0, canvas.width, canvas.height);

//     waveOffset += 0.02;

//     ctx.fillStyle = '#0077be';
//     ctx.fillRect(0, 0, canvas.width, canvas.height);

//     ctx.strokeStyle = 'rgba(255,255,255,0.2)';
//     ctx.lineWidth = 2;

//     for (let i = 0; i < canvas.width; i += 40) {
//         ctx.beginPath();
//         ctx.moveTo(i, 0);
//         ctx.lineTo(i + 20 * Math.sin(waveOffset + i * 0.01), canvas.height);
//         ctx.stroke();
//     }
// }

// function drawBoat() {
//     ctx.save();
//     ctx.translate(boat.x + boat.w / 2, boat.y + boat.h / 2);
//     ctx.rotate(boat.angle);

//     ctx.fillStyle = '#8b5a2b';
//     ctx.beginPath();
//     ctx.moveTo(0, -boat.h / 2);
//     ctx.lineTo(boat.w / 2, boat.h / 2);
//     ctx.lineTo(-boat.w / 2, boat.h / 2);
//     ctx.closePath();
//     ctx.fill();

//     ctx.fillStyle = '#ffffff';
//     ctx.fillRect(-15, -10, 30, 25);

//     ctx.restore();
// }

// function drawTrash() {
//     trashItems.forEach(t => {
//         ctx.fillStyle = '#555';
//         ctx.beginPath();
//         ctx.arc(t.x, t.y, t.size / 2, 0, Math.PI * 2);
//         ctx.fill();

//         ctx.fillStyle = '#999';
//         ctx.fillRect(t.x - 5, t.y - 5, 10, 10);
//     });
// }

// // =======================
// // GAME LOOP
// // =======================

// function gameLoop() {
//     updateBoat();
//     updateTrash();

//     drawOcean();
//     drawBoat();
//     drawTrash();

//     requestAnimationFrame(gameLoop);
// }

// window.addEventListener('keydown', e => keys[e.code] = true);
// window.addEventListener('keyup', e => keys[e.code] = false);

// gameLoop();alse);

// gameLoop();