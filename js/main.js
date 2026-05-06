import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

let isGamePlaying = false; // Empezamos en falso para que inicie pausado
//Escuchamos cuando el botón Start es presionado
window.addEventListener('iniciarJuego', () => {
    isGamePlaying = true;
    clock.start(); // Reiniciamos el reloj para que no haya un salto de tiempo
});

let scene, camera, renderer, clock, mixer;
let player, floor, actions = {}, currentAction;
let gameSpeed = 35;
let obstacles = []; 
let alienModel;

let currentLane = 1; 
const lanes = [-4, 0, 4];

let targetX = 0;
let targetRotation = Math.PI;

let alienAnimClip;

// Variables de lógica del juego
let distancia = 0;
let vida = 100;
let isGameOver = false;

//objetos
let decorations = [];

// Referencias al HTML
const textoDistancia = document.getElementById('texto-distancia');
const barraVida = document.getElementById('barra-vida');
const pantallaGameOver = document.getElementById('game-over');
const puntajeFinal = document.getElementById('puntaje-final');

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc);
    scene.fog = new THREE.Fog(0xcccccc, 15, 60);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 6, 12);
    camera.lookAt(0, 2, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.getElementById('container').appendChild(renderer.domElement);

    clock = new THREE.Clock();

    // Luces
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(5, 10, 5);
    light.castShadow = true;
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Suelo
    const textureLoader = new THREE.TextureLoader();
    const floorMat = new THREE.MeshStandardMaterial({ 
        map: textureLoader.load('textures/suelo.jpg') 
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
    loader.setPath('assets/');

    // PLAYER
    loader.load('Running.fbx', (fbx) => {
        player = fbx;
        player.scale.set(0.015, 0.015, 0.015);
        player.rotation.y = Math.PI;

        player.traverse(c => { if (c.isMesh) c.castShadow = true; });

        scene.add(player);

        targetX = lanes[currentLane]; // inicial
        targetRotation = Math.PI;

        mixer = new THREE.AnimationMixer(player);
        loadAnim(loader, 'Running.fbx', 'correr', true);
        loadAnim(loader, 'Big Jump.fbx', 'saltar', false);
        loadAnim(loader, 'Martelo 2.fbx', 'patada', false);
    });

    // ALIEN
    loader.load('AlienAttack.fbx', (fbx) => {
        alienModel = fbx;
        alienModel.scale.set(0.04, 0.04, 0.04);

        // Guardamos la animación que viene dentro del archivo
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
        for(let i = 0; i < 5; i++) spawnObstacle();
        // Genera 15 piedras decorativas
        for(let i = 0; i < 15; i++) spawnDecoration();

    }, undefined, (error) => {
        console.error("Error cargando Alien:", error);
    });

    window.addEventListener('keydown', onKeyDown);
}

function spawnObstacle() {
        if (!alienModel) return;

        const newAlien = SkeletonUtils.clone(alienModel);

        newAlien.position.x = lanes[Math.floor(Math.random() * 3)];
        newAlien.position.z = -Math.random() * 80 - 30;
        newAlien.rotation.y = 0; 

        //Creamos su reproductor de animación
        let alienMixer = null;
        if (alienAnimClip) {
            alienMixer = new THREE.AnimationMixer(newAlien);
            const action = alienMixer.clipAction(alienAnimClip);
            action.play();
        }

        // Guardamos el mixer para actualizarlo después
        newAlien.userData = { kicked: false, mixer: alienMixer };

        scene.add(newAlien);
        obstacles.push(newAlien);
    }

function onKeyDown(event) {
    if (!player) return;

    switch (event.code) {
        case 'KeyA':
            if (currentLane > 0) {
                currentLane--;
                movePlayer(); 
            }
            break;

        case 'KeyD':
            if (currentLane < 2) {
                currentLane++;
                movePlayer(); 
            }
            break;

        case 'Space':
            fadeToAction('saltar', 0.1);
            break;

        case 'KeyK':
            fadeToAction('patada', 0.1);
            break;
    }
}

// Solo desplazamiento lateral
function movePlayer() {
    targetX = lanes[currentLane];
    targetRotation = Math.PI; 
}

function recibirDano() {
    vida -= 25; // Restamos 25% (4 golpes = 0)
    
    // Actualizamos el ancho de la barra roja en pantalla
    barraVida.style.width = vida + '%';

    // Efecto visual: la barra se pone blanca un instante
    barraVida.style.backgroundColor = 'white';
    setTimeout(() => { barraVida.style.backgroundColor = '#ff3333'; }, 150);

    // Revisar si perdimos
    if (vida <= 0) {
        isGameOver = true;
        pantallaGameOver.style.display = 'flex'; // Mostramos pantalla negra
        puntajeFinal.innerText = `Metros recorridos: ${Math.floor(distancia)}`;
    }
}

function spawnDecoration() {
    // Un tamaño aleatorio entre 0.2 y 0.6
    const size = Math.random() * 0.4 + 0.2; 
    
    // El Dodecaedro es perfecto para simular piedras de videojuego
    const geometry = new THREE.DodecahedronGeometry(size);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x555555, // Color gris piedra
        roughness: 0.9,  // Sin brillo
        metalness: 0.1
    });
    
    const rock = new THREE.Mesh(geometry, material);

    // Posición aleatoria a lo ancho del suelo (entre -9 y 9)
    rock.position.x = (Math.random() - 0.5) * 18; 
    rock.position.y = size / 2; // Para que queden apoyadas en el suelo, no hundidas
    rock.position.z = -Math.random() * 150 - 20;

    // Rotación aleatoria para que cada roca se vea única
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    
    rock.castShadow = true;
    rock.receiveShadow = true;
    
    scene.add(rock);
    decorations.push(rock);
}

function animate() {
    requestAnimationFrame(animate);
    
    // Si no estamos jugando o ya perdimos, congelamos la lógica
    if (!isGamePlaying || isGameOver) {
        // Solo renderizamos la escena quieta como fondo del menú
        renderer.render(scene, camera);
        return; 
    }

    const delta = clock.getDelta();

    // Aumentar y mostrar distancia
    distancia += (gameSpeed * delta) * 0.2;
    textoDistancia.innerText = `Metros: ${Math.floor(distancia)}`;

    if (mixer) mixer.update(delta);

    if (player) {
        player.position.x += (targetX - player.position.x) * 10 * delta;
        player.rotation.y += (targetRotation - player.rotation.y) * 10 * delta;
    }

    if (floor && floor.material.map) {
        floor.material.map.offset.y += (gameSpeed * delta) / 10;
    }

    // Decoraciones
    decorations.forEach((dec) => {
        // Avanzan hacia el jugador con la velocidad del juego
        dec.position.z += gameSpeed * delta;

        // Si pasan de largo (salen de la cámara por detrás)
        if (dec.position.z > 2) {
            // Las regresamos muy lejos al fondo con una nueva posición aleatoria
            dec.position.x = (Math.random() - 0.5) * 18;
            dec.position.z = -Math.random() * 80 - 50;
            
            // Les damos un nuevo giro para que parezca una piedra distinta
            dec.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        }
    });

    obstacles.forEach((obs) => {
        if (obs.userData.mixer) obs.userData.mixer.update(delta);

        if (!obs.userData.kicked) {
            obs.position.z += (gameSpeed + 5) * delta;
            const dist = obs.position.distanceTo(player.position);

            if (dist < 2.5) {
                if (currentAction === actions['patada']) {
                    obs.userData.kicked = true;
                } else if (currentAction !== actions['saltar']) {
                    
                    // 🔥 NUEVO: Verificamos si ya habíamos chocado con este alien
                    if (!obs.userData.crashed) {
                        obs.userData.crashed = true; // Marcamos que ya nos pegó
                        recibirDano();
                    }
                }
            }
        } else {
            obs.position.z -= 60 * delta;
            obs.position.y += 40 * delta;
        }

        if (obs.position.z > 2 || obs.position.y > 60) {
            obs.position.set(
                lanes[Math.floor(Math.random() * 3)],
                0,
                -Math.random() * 80 - 50
            );
            obs.userData.kicked = false;
            
            // 🔥 NUEVO: Reiniciamos la colisión para cuando vuelva a aparecer
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

    if (name !== 'correr') {
        const restore = () => {
            mixer.removeEventListener('finished', restore);
            fadeToAction('correr', 0.2);
        };
        mixer.addEventListener('finished', restore);
    }
}