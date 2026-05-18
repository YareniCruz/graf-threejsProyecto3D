import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Importación para el botón de VR
import { VRButton } from 'three/addons/webxr/VRButton.js';

let isGamePlaying = false; 
window.addEventListener('iniciarJuego', () => {
    isGamePlaying = true;
    clock.start(); 
});

let scene, camera, renderer, clock, mixer;
let player, floor, actions = {}, currentAction;
let gameSpeed = 35;
let obstacles = []; 
let alienModel;

let currentLane = 1; 
const lanes = [-4, 0, 4];

let targetX = 0;
let targetRotation = 0; // Ajustado a 0 para Primera Persona (Mirando al frente)

let alienAnimClip;
let playerGroup;

let isKicking = false; // Para asegurar que la patada conecte siempre

// Controles VR
let controllerLeft, controllerRight;
let canMoveVR = true;

// Variables de lógica del juego
let distancia = 0;
let vida = 100;
let isGameOver = false;

// Objetos
let decorations = [];

// Vectores auxiliares para calcular colisiones globales en VR sin perder rendimiento
const posGlobalObstaculo = new THREE.Vector3();
const posGlobalJugador = new THREE.Vector3();

// Referencias al HTML
const textoDistancia = document.getElementById('texto-distancia');
const barraVida = document.getElementById('barra-vida');
const pantallaGameOver = document.getElementById('game-over');
const puntajeFinal = document.getElementById('puntaje-final');

init();

function init() {
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc);
    scene.fog = new THREE.Fog(0xcccccc, 15, 60);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    
    // --- VR CONFIG ---
    renderer.xr.enabled = true; 

    document.body.appendChild(VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'dom-overlay'],
    domOverlay: { root: document.getElementById('container') } // <--- Vincula la UI de juego
}));

    document.getElementById('container').appendChild(renderer.domElement);

    // Grupo contenedor para Primera Persona VR
    playerGroup = new THREE.Group(); 
    playerGroup.position.set(0, 0, 12); // Posición inicial en la pista
    scene.add(playerGroup);

    // En Primera Persona la cámara vive en el centro del grupo
    camera.position.set(0, 0, 0);
    playerGroup.add(camera);

    // Luces
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(5, 10, 5);
    light.castShadow = true;
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Suelo
    const textureLoader = new THREE.TextureLoader();
    const floorMat = new THREE.MeshStandardMaterial({ 
        map: textureLoader.load('textures/suelo_obscuro.jpg') 
    });
    floorMat.map.wrapS = floorMat.map.wrapT = THREE.RepeatWrapping;
    floorMat.map.repeat.set(1, 10);

    floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 200), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // HDR
    new RGBELoader().setPath('textures/').load('ambiente.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = texture;
        scene.environment = texture;
    });

    const loader = new FBXLoader();
    loader.setPath('./assets/');

    // PLAYER
    loader.load('Running.fbx', (fbx) => {
        player = fbx;
        player.scale.set(0.015, 0.015, 0.015);

        player.position.set(-0.04, -3.4, 0.85);
        playerGroup.add(player);

        player.rotation.y = Math.PI;

        player.traverse(c => { if (c.isMesh) c.castShadow = true; });


        targetX = lanes[currentLane]; // inicial
        targetRotation = Math.PI;

        mixer = new THREE.AnimationMixer(player);
        loadAnim(loader, 'Running.fbx', 'correr', true);
        loadAnim(loader, 'Big Jump.fbx', 'saltar', false);
        loadAnim(loader, 'Martelo 2.fbx', 'patada', false);
    });

    // ALIEN
    loader.load('AlienAttack2.fbx', (fbx) => {
        alienModel = fbx;
        alienModel.scale.set(0.025, 0.025, 0.025);

        if (fbx.animations && fbx.animations.length > 0) {
            alienAnimClip = fbx.animations[0];
        }

        alienModel.traverse(c => {
            if (c.isMesh) {
                c.castShadow = true;
                c.geometry.computeVertexNormals();
                c.frustumCulled = false;
            }
        });

        console.log("Alien cargado correctamente");
        spawnObstacle(); 
        setTimeout(() => { if (isGamePlaying && !isGameOver) spawnObstacle(); }, 2000);
        setTimeout(() => { if (isGamePlaying && !isGameOver) spawnObstacle(); }, 4000);

        for(let i = 0; i < 2; i++) spawnDecoration();

    }, undefined, (error) => {
        console.error("Error cargando Alien:", error);
    });

    window.addEventListener('keydown', onKeyDown);
    
    // Controles VR
    controllerLeft = renderer.xr.getController(0);
    scene.add(controllerLeft);

    controllerRight = renderer.xr.getController(1);
    scene.add(controllerRight);

    renderer.xr.setReferenceSpaceType('local-floor');
    
    controllerRight.addEventListener('selectstart', () => { fadeToAction('patada', 0.1); });
    controllerLeft.addEventListener('selectstart', () => { fadeToAction('saltar', 0.1); });

    // 🔥 FIJADO: El bucle de animación se inicializa una sola vez aquí afuera
    renderer.setAnimationLoop(animate);
}

function spawnObstacle() {
    if (!alienModel) return;

    const newAlien = SkeletonUtils.clone(alienModel);
    newAlien.position.x = lanes[Math.floor(Math.random() * 2)];
    newAlien.position.z = -Math.random() * 80 - 30;
    newAlien.rotation.y = 0; 

    let alienMixer = null;
    if (alienAnimClip) {
        alienMixer = new THREE.AnimationMixer(newAlien);
        const action = alienMixer.clipAction(alienAnimClip);
        action.play();
    }

    newAlien.userData = { kicked: false, mixer: alienMixer, crashed: false };
    scene.add(newAlien);
    obstacles.push(newAlien);
}

function onKeyDown(event) {
    if (!player) return;

    switch (event.code) {
        case 'KeyA':
            if (currentLane > 0) { currentLane--; movePlayer(); }
            break;
        case 'KeyD':
            if (currentLane < 2) { currentLane++; movePlayer(); }
            break;
        case 'Space':
            fadeToAction('saltar', 0.1);
            break;
        case 'KeyK':
            fadeToAction('patada', 0.1);
            break;
    }
}

function movePlayer() {
    targetX = lanes[currentLane];
    targetRotation = 0; 
}

function recibirDano() {
    vida -= 25; 
    barraVida.style.width = vida + '%';
    barraVida.style.backgroundColor = 'white';
    setTimeout(() => { barraVida.style.backgroundColor = '#ff3333'; }, 150);

    if (vida <= 0) {
        isGameOver = true;
        pantallaGameOver.style.display = 'flex'; 
        puntajeFinal.innerText = `Metros recorridos: ${Math.floor(distancia)}`;
    }
}

function spawnDecoration() {
    const size = 2; 
    const geometry = new THREE.DodecahedronGeometry(size);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x555555, 
        roughness: 0.9,  
        metalness: 0.1
    });
    
    const rock = new THREE.Mesh(geometry, material);
    rock.position.x = (Math.random() - 0.5) * 18; 
    rock.position.y = size / 2; 
    rock.position.z = -Math.random() * 150 - 20;
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    decorations.push(rock);
}

function handleVRInput() {
    const session = renderer.xr.getSession();
    if (!session) return;

    for (const source of session.inputSources) {
        if (!source.gamepad) continue;

        const axes = source.gamepad.axes;
        const stickX = axes[2] || axes[0]; 

        if (Math.abs(stickX) > 0.5) {
            if (stickX < -0.5 && currentLane > 0) { 
                currentLane--;
                movePlayer();
                canMoveVR = false; 
                setTimeout(() => { canMoveVR = true; }, 300);
            } 
            else if (stickX > 0.5 && currentLane < 2) { 
                currentLane++;
                movePlayer();
                canMoveVR = false;
                setTimeout(() => { canMoveVR = true; }, 300);
            }
        }
    }
}

function animate() {
    
    if (!isGamePlaying || isGameOver) {
        renderer.render(scene, camera);
        return; 
    }

    if (renderer.xr.isPresenting && canMoveVR) {
        handleVRInput();
    }

    const delta = clock.getDelta();

    distancia += (gameSpeed * delta) * 0.2;
    textoDistancia.innerText = `Metros: ${Math.floor(distancia)}`;

    if (mixer) mixer.update(delta);

    //Movimiento lateral reactivado para Primera persona
    if (player) {
        playerGroup.position.x += (targetX - playerGroup.position.x) * 10 * delta;
    }

    if (floor && floor.material.map) {
        floor.material.map.offset.y += (gameSpeed * delta) / 10;
    }

    decorations.forEach((dec) => {
        dec.position.z += gameSpeed * delta;
        if (dec.position.z > playerGroup.position.z + 5) {
            dec.position.x = (Math.random() - 0.5) * 18;
            dec.position.z = playerGroup.position.z - 100;
            dec.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        }
    });

    obstacles.forEach((obs) => {
        if (obs.userData.mixer) obs.userData.mixer.update(delta);

        if (!obs.userData.kicked) {
            obs.position.z += (gameSpeed + 5) * delta;
            
            obs.getWorldPosition(posGlobalObstaculo);
            player.getWorldPosition(posGlobalJugador);

            const dist = posGlobalObstaculo.distanceTo(posGlobalJugador);

            if (dist < 2.0) { // Radio de colisión
                if (isKicking) { 
                    obs.userData.kicked = true; 
                } else if (currentAction !== actions['saltar']) {
                    //Si no patea ni salta, te hace daño
                    if (!obs.userData.crashed) {
                        obs.userData.crashed = true; 
                        recibirDano();
                    }
                }
            }
        } else {
            obs.position.z -= 60 * delta;
            obs.position.y += 40 * delta;
        }

        // Reciclaje de obstáculos tomando como referencia la posición Z actual de tu vista VR
        if (obs.position.z > playerGroup.position.z + 5 || obs.position.y > 60) {
            obs.position.set(
                lanes[Math.floor(Math.random() * 3)],
                0,
                playerGroup.position.z - 80
            );
            obs.userData.kicked = false;
            obs.userData.crashed = false; 
        }
    });

    renderer.render(scene, camera);
}

function loadAnim(loader, file, name, loop) {
    loader.load(file, (anim) => {
        const action = mixer.clipAction(anim.animations[0]);

        if (!loop) {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
        }

        actions[name] = action;

        if (name === 'correr') {
            action.play();
            currentAction = action;
        }
    });
}

function fadeToAction(name, duration) {
    if (!actions[name] || currentAction === actions[name]) return;

    const prev = currentAction;
    currentAction = actions[name];

    if (prev) prev.fadeOut(duration);
    currentAction.reset().fadeIn(duration).play();

    //Si la acción es la patada, activamos el interruptor
    if (name === 'patada') {
        isKicking = true;
    }

    if (name !== 'correr') {
        const restore = () => {
            mixer.removeEventListener('finished', restore);

            //Cuando la animación termine, apagamos el interruptor
            if (name === 'patada') isKicking = false;
            fadeToAction('correr', 0.2);
        };
        mixer.addEventListener('finished', restore);
    }
}