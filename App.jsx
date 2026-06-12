import { useState, useEffect, useRef, useCallback } from "react";
import { fbSet, fbGet } from "./Firebase.js";

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────

const getUsers = () => {
  try { return JSON.parse(localStorage.getItem("rku_users")||"{}"); } catch { return {}; }
};
const saveUsers = async (users) => {
  localStorage.setItem("rku_users", JSON.stringify(users));
  // Convert to array for Firebase (email keys can have invalid chars)
  const safeUsers = {};
  Object.entries(users).forEach(([email, data]) => {
    const key = email.replace(/\./g,"_").replace(/@/g,"_at_").replace(/[#$\[\]]/g,"_");
    safeUsers[key] = {...data, email};
  });
  await fbSet("users", safeUsers).catch(()=>{});
};
const getUserData = (email) => {
  try { return JSON.parse(localStorage.getItem(`rku_data_${email}`)||"null"); } catch { return null; }
};

// Merge two user data objects, always keeping the most progress
const mergeUserData = (local, remote) => {
  if(!local && !remote) return null;
  if(!local) return remote;
  if(!remote) return local;
  return {
    ...remote,                                        // base: remote (source of truth)
    totalXp:    Math.max(local.totalXp||0,  remote.totalXp||0),
    coins:      Math.max(local.coins||0,    remote.coins||0),
    checked:    {...(remote.checked||{}),   ...(local.checked||{})},   // union: keep all checked
    weights:    {...(remote.weights||{}),   ...(local.weights||{})},
    personalRecords: {...(remote.personalRecords||{}), ...(local.personalRecords||{})},
    earnedAchs: [...new Set([...(remote.earnedAchs||[]), ...(local.earnedAchs||[])])],
    redeemedRewards: (remote.redeemedRewards||[]).length >= (local.redeemedRewards||[]).length
                      ? (remote.redeemedRewards||[])
                      : (local.redeemedRewards||[]),
    dungeonCoins: {...(remote.dungeonCoins||{}), ...(local.dungeonCoins||{})},
    customRoutines: (remote.customRoutines||[]).length >= (local.customRoutines||[]).length
                      ? (remote.customRoutines||[])
                      : (local.customRoutines||[]),
    playerClass:    remote.playerClass || local.playerClass || null,
    assignedDiets:  (remote.assignedDiets||[]).length >= (local.assignedDiets||[]).length
                      ? (remote.assignedDiets||[])
                      : (local.assignedDiets||[]),
    assignedProgram: remote.assignedProgram || local.assignedProgram || null,
  };
};

const saveUserData = async (email, data) => {
  const key = email.replace(/\./g,"_").replace(/@/g,"_at_");
  localStorage.setItem(`rku_data_${email}`, JSON.stringify(data));
  await fbSet(`userData/${key}`, data).catch(()=>{});
};
const syncFromFirebase = async (email) => {
  const key = email.replace(/\./g,"_").replace(/@/g,"_at_");
  const [safeUsers, remoteData] = await Promise.all([fbGet("users"), fbGet(`userData/${key}`)]);
  if(safeUsers){
    const users = {};
    Object.values(safeUsers).forEach(u => { if(u.email) users[u.email] = u; });
    localStorage.setItem("rku_users", JSON.stringify(users));
  }
  const localData = getUserData(email);
  // Merge remote + local, keeping highest progress
  const merged = mergeUserData(localData, remoteData);
  if(merged){
    localStorage.setItem(`rku_data_${email}`, JSON.stringify(merged));
    // Write merged back to Firebase so both are in sync
    if(remoteData) await fbSet(`userData/${key}`, merged).catch(()=>{});
  }
  return { users: getUsers(), userData: merged };
};
const syncUsersFromFirebase = async () => {
  const safeUsers = await fbGet("users");
  if(safeUsers){
    const users = {};
    Object.entries(safeUsers).forEach(([key, u]) => {
      // Get email from object or reconstruct from key
      const email = u.email || key.replace(/_at_/g,"@").replace(/_/g,".");
      users[email] = {...u, email};
    });
    localStorage.setItem("rku_users", JSON.stringify(users));
    return users;
  }
  return getUsers();
};
// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const RANKS = [
  { rank:"E", title:"Novato",  minLevel:1,  maxLevel:9,  color:"#9CA3AF", glow:"#6B7280" },
  { rank:"D", title:"Regular", minLevel:10, maxLevel:19, color:"#60A5FA", glow:"#3B82F6" },
  { rank:"C", title:"Élite",         minLevel:20, maxLevel:29, color:"#34D399", glow:"#10B981" },
  { rank:"B", title:"Avanzado",      minLevel:30, maxLevel:39, color:"#FBBF24", glow:"#F59E0B" },
  { rank:"A", title:"Maestro",    minLevel:40, maxLevel:49, color:"#F87171", glow:"#EF4444" },
  { rank:"S", title:"Mítico",    minLevel:50, maxLevel:99, color:"#A78BFA", glow:"#8B5CF6" },
];
const XP_PER_LEVEL=500, COIN_DUNGEON=75, COIN_BOSS_EX=30, COIN_WEEK=150, COIN_PHASE=500;

const MUSCLE_RANKS = [
  { rank:"—", label:"Sin activar",  color:"#2A2A44", glow:"#2A2A4466", min:0    },
  { rank:"E", label:"Novato",    color:"#9CA3AF", glow:"#6B728066", min:1    },
  { rank:"D", label:"Regular",   color:"#60A5FA", glow:"#3B82F666", min:200  },
  { rank:"C", label:"Élite",           color:"#34D399", glow:"#10B98166", min:600  },
  { rank:"B", label:"Avanzado",        color:"#FBBF24", glow:"#F59E0B66", min:1200 },
  { rank:"A", label:"Maestro",      color:"#F87171", glow:"#EF444466", min:2000 },
  { rank:"S", label:"Mítico",      color:"#A78BFA", glow:"#8B5CF666", min:3000 },
];

const CLASSES = [
  { id:"guerrero",   icon:"⚔️",  name:"Guerrero",    goal:"Masa muscular",        color:"#F87171", desc:"Forja músculo con hierro y voluntad. Fuerza e hipertrofia son tu camino.",     bonus:"XP x1.2 en ejercicios de fuerza" },
  { id:"explorador", icon:"🏃",  name:"Explorador",  goal:"Pérdida de grasa",     color:"#34D399", desc:"Velocidad, resistencia y quema de calorías. El movimiento es tu arma.",        bonus:"XP x1.3 en cardio y circuitos"   },
  { id:"titan",      icon:"🛡️",  name:"Titán",       goal:"Fuerza máxima",        color:"#FBBF24", desc:"Levantar lo que otros no pueden ni imaginar. Potencia pura y récords.",          bonus:"XP x1.5 al superar un récord"    },
  { id:"acrobata",   icon:"🤸",  name:"Acróbata",    goal:"Movilidad y agilidad", color:"#60A5FA", desc:"Control total del cuerpo. Flexibilidad, equilibrio y movimiento funcional.",    bonus:"XP x1.3 en ejercicios de movilidad" },
  { id:"alquimista", icon:"⚗️",  name:"Alquimista",  goal:"Recomposición corporal",color:"#F59E0B", desc:"La ciencia del cuerpo: ganar músculo y perder grasa al mismo tiempo.",          bonus:"XP x1.1 en todos los ejercicios" },
];


// ─── CLASS XP MULTIPLIER ─────────────────────────────────────────────────────
const MOBILITY_EXERCISES = new Set([
  "Hip Flexor Stretch","Cat-Cow","Pigeon Pose","Thoracic Rotation","World's Greatest Stretch",
  "Ankle Mobility Drill","Sentadilla de Movilidad","Apertura de Cadera en Suelo",
  "Rotacion de Cadera de Pie","Estiramiento de Isquiotibiales","Estiramiento de Cuadriceps",
  "Estiramiento de Gemelo","Estiramiento de Pectoral","Estiramiento de Dorsal",
  "Estiramiento de Triceps","Estiramiento de Hombro Cruzado","Cobra","Child's Pose",
  "Rotacion de Columna Tumbado","Movilidad de Muneca","Apertura Toracica en Banco",
  "Inchworm","Leg Swing Frontal","Leg Swing Lateral","Shoulder Pass-Through","Foam Roller Espalda",
  "Rotaciones Externas Hombro","Rotaciones Internas Hombro","Dead Bug","Hollow Body Hold",
  "Pallof Press","World's Greatest Stretch","Ankle Mobility Drill"
]);

const STRENGTH_EXERCISES = new Set([
  "Press Banca Plano","Press Banca Inclinado","Press Banca Declinado","Press Declinado",
  "Press Inclinado Mancuernas","Press con Mancuernas Plano","Press con Mancuernas Declinado",
  "Press Banca con Agarre Neutro","Press Cerrado","Smith Machine Press Banca",
  "Peso Muerto","Peso Muerto Rumano","Peso Muerto Sumo","Peso Muerto con Mancuernas",
  "Peso Muerto sobre Escalon","Peso Muerto Buenos Dias",
  "Sentadilla con Barra","Sentadilla Bulgara","Front Squat","Sentadilla Hack con Barra",
  "Sentadilla Sumo","Sentadilla en Cajon","Smith Machine Sentadilla",
  "Press Militar Barra","Press Militar Tras Nuca","Press Militar en Multipower",
  "Dominadas","Dominadas Lastradas","Dominadas con Agarre Neutro","Chin-Up",
  "Remo con Barra","Remo en T","Remo en Punta","Remo con Barra Underhand",
  "Hip Thrust con Barra","Hip Thrust Unilateral",
  "Fondos en Paralelas","Press Frances","Press Frances con Barra Z","Press Frances con Mancuernas",
  "Thruster","Clean and Press","Hack Squat","Prensa 45","Zancadas con Barra",
  "Buenos Dias","Good Morning","Sentadilla Hack","Press Arnold","Press Arnold Sentado"
]);

const CARDIO_EXERCISES = new Set([
  "HIIT en Cinta","Bici Estatica HIIT","Remo Ergometro","Burpees","Salto a la Comba",
  "Cardio Zona 2","Saltos a la Comba","Kettlebell Swing","Box Jump","Jump Squat",
  "Battle Ropes","Sled Push","Wall Ball","Mountain Climbers","Salto de Tijera (Jumping Jack)",
  "Farmer's Carry","Farmer's Walk"
]);

const getClassMultiplier = (playerClass, exName, exXp, isRecord=false) => {
  if(!playerClass) return 1;
  const muscles = MUSCLE_MAP[exName] || [];
  const isCardio = muscles.includes("cardio") || CARDIO_EXERCISES.has(exName);
  const isMobility = MOBILITY_EXERCISES.has(exName) || exXp <= 18;
  const isStrength = STRENGTH_EXERCISES.has(exName) || (!isCardio && !isMobility && exXp >= 40);

  switch(playerClass){
    case "guerrero":   return isStrength ? 1.2 : 1;
    case "explorador": return isCardio   ? 1.3 : 1;
    case "titan":      return isRecord   ? 1.5 : 1;
    case "acrobata":   return isMobility ? 1.3 : 1;
    case "alquimista": return 1.1;
    default:           return 1;
  }
};

const MUSCLE_DEFS = {
  pecho:      { label:"Pecho",      recov:48, side:"front" },
  espalda:    { label:"Espalda",    recov:72, side:"back"  },
  hombros:    { label:"Hombros",    recov:48, side:"both"  },
  biceps:     { label:"Bíceps",     recov:24, side:"front" },
  triceps:    { label:"Tríceps",    recov:48, side:"back"  },
  antebrazos: { label:"Antebrazos", recov:24, side:"front" },
  abdomen:    { label:"Abdomen",    recov:28, side:"front" },
  piernas:    { label:"Piernas",    recov:72, side:"both"  },
  gluteos:    { label:"Glúteos",    recov:48, side:"back"  },
  gemelos:    { label:"Gemelos",    recov:24, side:"back"  },
  cardio:     { label:"Cardio",     recov:24, side:"front" },
};

// ─── EXERCISE DATABASE (80 exercises) ────────────────────────────────────────
const EXERCISE_DB = [
  {id:"e001",name:"Press Banca Plano",     muscle:["pecho"],           equip:"Barra",      level:"Principiante", xpBase:40, desc:"Movimiento básico de pecho en banco plano."},
  {id:"e002",name:"Press Banca Inclinado", muscle:["pecho"],           equip:"Barra",      level:"Principiante", xpBase:42, desc:"Trabaja la parte superior del pecho."},
  {id:"e003",name:"Press Inclinado Mancuernas",muscle:["pecho"],       equip:"Mancuernas", level:"Principiante", xpBase:40, desc:"Mayor rango que con barra."},
  {id:"e004",name:"Aperturas con Mancuernas",  muscle:["pecho"],       equip:"Mancuernas", level:"Principiante", xpBase:35, desc:"Aislamiento de pecho en banco plano."},
  {id:"e005",name:"Aperturas Inclinado",    muscle:["pecho"],           equip:"Mancuernas", level:"Principiante", xpBase:35, desc:"Parte alta del pecho."},
  {id:"e006",name:"Flexiones",              muscle:["pecho","triceps"], equip:"Sin equipo", level:"Principiante", xpBase:30, desc:"Clásico sin equipo."},
  {id:"e007",name:"Fondos en Paralelas",    muscle:["pecho","triceps"], equip:"Barras",     level:"Intermedio",   xpBase:40, desc:"Pecho inferior y tríceps."},
  {id:"e008",name:"Crossover en Polea",     muscle:["pecho"],           equip:"Polea",      level:"Intermedio",   xpBase:35, desc:"Tensión constante en pecho."},
  {id:"e009",name:"Press en Máquina",       muscle:["pecho"],           equip:"Máquina",    level:"Principiante", xpBase:35, desc:"Ideal para principiantes."},
  {id:"e010",name:"Press Declinado",        muscle:["pecho"],           equip:"Barra",      level:"Intermedio",   xpBase:42, desc:"Pecho inferior con barra."},
  {id:"e011",name:"Peso Muerto",            muscle:["espalda","piernas","antebrazos"],equip:"Barra",level:"Intermedio",xpBase:70,desc:"Rey de los ejercicios. Alta demanda de agarre."},
  {id:"e012",name:"Peso Muerto Rumano",     muscle:["piernas","espalda"],equip:"Barra",     level:"Principiante", xpBase:45, desc:"Foco en isquios y lumbar."},
  {id:"e013",name:"Remo con Barra",         muscle:["espalda","antebrazos"],equip:"Barra",  level:"Intermedio",   xpBase:45, desc:"Básico de espalda. Alta demanda de antebrazos."},
  {id:"e014",name:"Remo en T",              muscle:["espalda","antebrazos"],equip:"Máquina",level:"Intermedio",   xpBase:45, desc:"Centro de la espalda. Trabaja antebrazos."},
  {id:"e015",name:"Remo con Mancuerna",     muscle:["espalda","antebrazos"],equip:"Mancuernas",level:"Principiante",xpBase:40,desc:"Unilateral, buen rango. Trabaja antebrazos."},
  {id:"e016",name:"Dominadas",              muscle:["espalda","antebrazos"],equip:"Barra",  level:"Intermedio",   xpBase:55, desc:"El mejor ejercicio para el dorsal. Fuerte demanda de antebrazos."},
  {id:"e017",name:"Dominadas Lastradas",    muscle:["espalda","antebrazos"],equip:"Barra",  level:"Avanzado",     xpBase:65, desc:"Dominadas con peso. Alta demanda de agarre."},
  {id:"e018",name:"Jalones al Pecho",       muscle:["espalda","antebrazos"],equip:"Polea",  level:"Principiante", xpBase:40, desc:"Alternativa a dominadas. Trabaja antebrazos."},
  {id:"e019",name:"Face Pull",              muscle:["espalda","hombros"],equip:"Polea",     level:"Principiante", xpBase:30, desc:"Salud de manguito rotador."},
  {id:"e020",name:"Pull-over Mancuerna",    muscle:["espalda","pecho"],  equip:"Mancuernas",level:"Intermedio",   xpBase:38, desc:"Dorsal y pecho en estiramiento."},
  {id:"e021",name:"Buenos Días",            muscle:["espalda","piernas"],equip:"Barra",     level:"Intermedio",   xpBase:50, desc:"Fortalece lumbar e isquios."},
  {id:"e022",name:"Press Militar Barra",    muscle:["hombros"],          equip:"Barra",     level:"Intermedio",   xpBase:55, desc:"Básico de hombros."},
  {id:"e023",name:"Press Militar Mancuernas",muscle:["hombros"],         equip:"Mancuernas",level:"Principiante", xpBase:45, desc:"Más rango y estabilización."},
  {id:"e024",name:"Press Arnold",           muscle:["hombros"],          equip:"Mancuernas",level:"Intermedio",   xpBase:48, desc:"Giro de muñeca, más fibras."},
  {id:"e025",name:"Elevaciones Laterales",  muscle:["hombros"],          equip:"Mancuernas",level:"Principiante", xpBase:30, desc:"Aislamiento deltoides lateral."},
  {id:"e026",name:"Elevaciones Frontales",  muscle:["hombros"],          equip:"Mancuernas",level:"Principiante", xpBase:28, desc:"Deltoides anterior."},
  {id:"e027",name:"Elevaciones Posteriores",muscle:["hombros","espalda"],equip:"Mancuernas",level:"Principiante", xpBase:30, desc:"Deltoides posterior."},
  {id:"e028",name:"Remo al Mentón",         muscle:["hombros","espalda"],equip:"Barra",     level:"Intermedio",   xpBase:38, desc:"Trapecio y deltoides lateral."},
  {id:"e029",name:"Sentadilla con Barra",   muscle:["piernas","gluteos","gemelos"],equip:"Barra",level:"Intermedio",xpBase:55, desc:"La reina de los ejercicios de pierna. Activa gemelos."},
  {id:"e030",name:"Sentadilla Búlgara",     muscle:["piernas","gluteos","gemelos"],equip:"Mancuernas",level:"Intermedio",xpBase:55, desc:"Unilateral, gran reto de equilibrio. Activa gemelos."},
  {id:"e031",name:"Sentadilla Goblet",      muscle:["piernas","gluteos"],equip:"Mancuernas",level:"Principiante", xpBase:35, desc:"Ideal para aprender la técnica."},
  {id:"e032",name:"Front Squat",            muscle:["piernas","gluteos"],equip:"Barra",     level:"Avanzado",     xpBase:65, desc:"Mayor activación de cuádriceps."},
  {id:"e033",name:"Hack Squat",             muscle:["piernas","gemelos"],equip:"Máquina",   level:"Intermedio",   xpBase:45, desc:"Cuádriceps sin carga lumbar. Activa gemelos."},
  {id:"e034",name:"Prensa 45°",             muscle:["piernas","gemelos"],equip:"Máquina",   level:"Principiante", xpBase:40, desc:"Gran volumen de carga. Activa gemelos al empujar."},
  {id:"e035",name:"Zancadas Caminando",     muscle:["piernas","gluteos"],equip:"Mancuernas",level:"Principiante", xpBase:38, desc:"Dinámicas, trabajan equilibrio."},
  {id:"e036",name:"Extensión de Cuádriceps",muscle:["piernas"],          equip:"Máquina",   level:"Principiante", xpBase:30, desc:"Aislamiento del cuádriceps."},
  {id:"e037",name:"Curl Femoral Tumbado",   muscle:["piernas"],          equip:"Máquina",   level:"Principiante", xpBase:30, desc:"Aislamiento de isquiotibiales."},
  {id:"e038",name:"Elevación de Talones",   muscle:["gemelos"],         equip:"Máquina",   level:"Principiante", xpBase:25, desc:"Gemelos de pie. Aislamiento completo."},
  {id:"e039",name:"Step-Up Mancuernas",     muscle:["piernas","gluteos"],equip:"Mancuernas",level:"Principiante", xpBase:35, desc:"Funcional, gran activación glúteo."},
  {id:"e040",name:"Hip Thrust con Barra",   muscle:["gluteos"],          equip:"Barra",     level:"Principiante", xpBase:50, desc:"El mejor ejercicio para glúteos."},
  {id:"e041",name:"Hip Thrust Unilateral",  muscle:["gluteos"],          equip:"Barra",     level:"Intermedio",   xpBase:52, desc:"Mayor intensidad por lado."},
  {id:"e042",name:"Patada de Glúteo Polea", muscle:["gluteos"],          equip:"Polea",     level:"Principiante", xpBase:30, desc:"Aislamiento con tensión constante."},
  {id:"e043",name:"Abducción en Máquina",   muscle:["gluteos"],          equip:"Máquina",   level:"Principiante", xpBase:28, desc:"Glúteo medio y mayor."},
  {id:"e044",name:"Peso Muerto Sumo",       muscle:["gluteos","piernas"],equip:"Barra",     level:"Intermedio",   xpBase:55, desc:"Mayor activación de glúteos."},
  {id:"e045",name:"Curl con Barra",         muscle:["biceps"],           equip:"Barra",     level:"Principiante", xpBase:35, desc:"Básico de bíceps."},
  {id:"e046",name:"Curl con Mancuernas",    muscle:["biceps"],           equip:"Mancuernas",level:"Principiante", xpBase:32, desc:"Permite supinación completa."},
  {id:"e047",name:"Curl Martillo",          muscle:["biceps","antebrazos"], equip:"Mancuernas",level:"Principiante", xpBase:32, desc:"Trabaja el braquioradial y antebrazos."},
  {id:"e048",name:"Curl Inclinado",         muscle:["biceps"],           equip:"Mancuernas",level:"Principiante", xpBase:35, desc:"Mayor estiramiento del bíceps."},
  {id:"e049",name:"Curl Concentrado",       muscle:["biceps"],           equip:"Mancuernas",level:"Principiante", xpBase:30, desc:"Máximo aislamiento."},
  {id:"e050",name:"Curl Scott",             muscle:["biceps"],           equip:"Barra",     level:"Intermedio",   xpBase:38, desc:"Elimina el impulso del cuerpo."},
  {id:"e051",name:"Press Francés",          muscle:["triceps"],          equip:"Barra",     level:"Intermedio",   xpBase:38, desc:"Gran ejercicio de masa para tríceps."},
  {id:"e052",name:"Extensión Polea Alta",   muscle:["triceps"],          equip:"Polea",     level:"Principiante", xpBase:32, desc:"Buena congestión en tríceps."},
  {id:"e053",name:"Extensión Polea Cuerda", muscle:["triceps"],          equip:"Polea",     level:"Principiante", xpBase:33, desc:"Separación al final del movimiento."},
  {id:"e054",name:"Extensión sobre Cabeza", muscle:["triceps"],          equip:"Mancuernas",level:"Principiante", xpBase:33, desc:"Cabeza larga del tríceps."},
  {id:"e055",name:"Fondos en Banco",        muscle:["triceps"],          equip:"Banco",     level:"Principiante", xpBase:28, desc:"Sin equipo, buen volumen."},
  {id:"e056",name:"Press Cerrado",          muscle:["triceps","pecho"],  equip:"Barra",     level:"Intermedio",   xpBase:45, desc:"Compuesto, gran carga."},
  {id:"e057",name:"Plancha",                muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:25, desc:"Estabilidad del core completo."},
  {id:"e058",name:"Plancha Lateral",        muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:25, desc:"Oblicuos y estabilización."},
  {id:"e059",name:"Crunch Abdominal",       muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:22, desc:"Básico de abdomen."},
  {id:"e060",name:"Crunch en Polea",        muscle:["abdomen"],          equip:"Polea",     level:"Principiante", xpBase:28, desc:"Con carga añadida."},
  {id:"e061",name:"Rueda Abdominal",        muscle:["abdomen"],          equip:"Rueda",     level:"Intermedio",   xpBase:40, desc:"Uno de los más efectivos para el core."},
  {id:"e062",name:"Elevación de Piernas",   muscle:["abdomen"],          equip:"Sin equipo",level:"Intermedio",   xpBase:30, desc:"Abdomen bajo."},
  {id:"e063",name:"Russian Twist",          muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:25, desc:"Rotación para oblicuos."},
  {id:"e064",name:"Dead Bug",               muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:25, desc:"Control motor del core."},
  {id:"e065",name:"HIIT en Cinta",          muscle:["cardio"],           equip:"Cinta",     level:"Intermedio",   xpBase:80, desc:"Intervalos de sprint en cinta."},
  {id:"e066",name:"Bici Estática HIIT",     muscle:["cardio"],           equip:"Bicicleta", level:"Principiante", xpBase:70, desc:"Menos impacto articular."},
  {id:"e067",name:"Remo Ergómetro",         muscle:["cardio","espalda"], equip:"Remo",      level:"Intermedio",   xpBase:75, desc:"Cardio que trabaja espalda y piernas."},
  {id:"e068",name:"Burpees",                muscle:["cardio","gemelos"], equip:"Sin equipo",level:"Intermedio",   xpBase:60, desc:"Cardio metabólico. Activa gemelos."},
  {id:"e069",name:"Salto a la Comba",       muscle:["cardio","gemelos"], equip:"Comba",     level:"Principiante", xpBase:55, desc:"Cardio clásico. Gemelos como motor principal."},
  {id:"e070",name:"Cardio Zona 2",          muscle:["cardio"],           equip:"Cualquiera",level:"Principiante", xpBase:50, desc:"Baja intensidad, mejora base aeróbica."},
  // NUEVOS
  {id:"e071",name:"Peso Muerto Rumano",     muscle:["piernas","espalda"],equip:"Barra",     level:"Principiante", xpBase:48, desc:"Romanian Deadlift. Foco en isquiotibiales y lumbar con rodillas semiflexionadas."},
  {id:"e072",name:"Sentadilla Hack",        muscle:["piernas"],          equip:"Máquina",   level:"Intermedio",   xpBase:47, desc:"Hack Squat en máquina. Gran activación de cuádriceps sin carga lumbar."},
  {id:"e073",name:"Elevación de Pelvis",    muscle:["gluteos"],          equip:"Barra",     level:"Principiante", xpBase:50, desc:"Hip Thrust. El ejercicio más efectivo para activar el glúteo mayor."},
  {id:"e074",name:"Remo Gironda",           muscle:["espalda"],          equip:"Polea",     level:"Intermedio",   xpBase:44, desc:"Remo en polea baja con agarre supino. Máximo recorrido y activación del dorsal."},
  {id:"e075",name:"Pull-Over en Polea Alta",muscle:["espalda","pecho"],  equip:"Polea",     level:"Intermedio",   xpBase:40, desc:"Cable Pullover. Tensión constante en dorsal y serrato anterior."},
  {id:"e076",name:"Aperturas Inclinadas",   muscle:["pecho"],            equip:"Mancuernas",level:"Principiante", xpBase:36, desc:"Aperturas en banco inclinado. Aislamiento de la parte superior del pecho."},
  {id:"e077",name:"Curl Inverso con Barra", muscle:["antebrazos"],       equip:"Barra",     level:"Intermedio",   xpBase:32, desc:"Agarre prono. Trabaja extensores del antebrazo."},
  {id:"e078",name:"Curl Martillo Cable",    muscle:["biceps","antebrazos"],equip:"Polea",   level:"Principiante", xpBase:33, desc:"Hammer Curl en polea. Tensión constante en bíceps y antebrazos."},
  {id:"e079",name:"Rueda Abdominal",        muscle:["abdomen"],          equip:"Rueda",     level:"Intermedio",   xpBase:42, desc:"Ab Wheel. Uno de los ejercicios más exigentes para el core completo."},
  {id:"e080",name:"Elevaciones de Piernas Colgado",muscle:["abdomen"],  equip:"Barra",     level:"Intermedio",   xpBase:38, desc:"Hanging Leg Raises. Abdomen bajo e iliopsoas con cuerpo en suspensión."},
  // ── GEMELOS ──────────────────────────────────────────────────────────────────
  {id:"e081",name:"Elevación Talones Sentado",   muscle:["gemelos"],      equip:"Máquina",   level:"Principiante", xpBase:28, desc:"Gemelo sóleo. Músculo profundo del gemelo."},
  {id:"e082",name:"Elevación Talones Una Pierna",muscle:["gemelos"],      equip:"Sin equipo",level:"Principiante", xpBase:26, desc:"Unilateral para mayor activación."},
  {id:"e083",name:"Prensa con Gemelos",          muscle:["gemelos"],      equip:"Máquina",   level:"Principiante", xpBase:30, desc:"Gemelos en prensa. Alta carga segura."},
  {id:"e084",name:"Saltos a la Comba",           muscle:["gemelos","cardio"],equip:"Sin equipo",level:"Principiante",xpBase:32,desc:"Cardio y gemelos simultáneamente."},
  {id:"e085",name:"Burpees",                     muscle:["cardio","piernas"],equip:"Sin equipo",level:"Intermedio", xpBase:38, desc:"Ejercicio total body cardiovascular."},
  // ── ANTEBRAZOS ───────────────────────────────────────────────────────────────
  {id:"e086",name:"Curl de Muñeca con Barra",    muscle:["antebrazos"],   equip:"Barra",     level:"Principiante", xpBase:25, desc:"Flexores del antebrazo. Movimiento de muñeca."},
  {id:"e087",name:"Curl Muñeca Inverso",         muscle:["antebrazos"],   equip:"Barra",     level:"Principiante", xpBase:25, desc:"Extensores del antebrazo. Agarre prono."},
  {id:"e088",name:"Agarre con Pinza",            muscle:["antebrazos"],   equip:"Disco",     level:"Principiante", xpBase:22, desc:"Fuerza de agarre con disco entre dedos."},
  {id:"e089",name:"Farmer's Walk",               muscle:["antebrazos","hombros"],equip:"Mancuernas",level:"Principiante",xpBase:35,desc:"Caminar con carga. Fuerza de agarre funcional."},
  {id:"e090",name:"Dead Hang",                   muscle:["antebrazos","espalda"],equip:"Barra",level:"Principiante",xpBase:30,desc:"Colgarse de la barra. Fuerza de agarre y descompresión."},

  // ── PECHO EXTRA ──────────────────────────────────────────────────────────────
  {id:"e091",name:"Press con Mancuernas Plano",  muscle:["pecho","triceps"],  equip:"Mancuernas",level:"Principiante", xpBase:42, desc:"Mayor rango de movimiento que con barra en banco plano."},
  {id:"e092",name:"Press con Mancuernas Declinado",muscle:["pecho"],          equip:"Mancuernas",level:"Intermedio",   xpBase:40, desc:"Pecho inferior con más rango y estabilización."},
  {id:"e093",name:"Aperturas en Máquina (Peck Deck)",muscle:["pecho"],        equip:"Máquina",   level:"Principiante", xpBase:32, desc:"Tensión constante en pecho. Ideal para congestión final."},
  {id:"e094",name:"Cable Fly Bajo",              muscle:["pecho"],            equip:"Polea",     level:"Principiante", xpBase:34, desc:"Apertura en polea baja. Activa la parte superior del pecho."},
  {id:"e095",name:"Flexiones Diamante",          muscle:["pecho","triceps"],  equip:"Sin equipo",level:"Intermedio",   xpBase:35, desc:"Manos juntas. Mayor activación de tríceps y pecho interno."},
  {id:"e096",name:"Flexiones Inclinadas",        muscle:["pecho"],            equip:"Sin equipo",level:"Principiante", xpBase:28, desc:"Manos elevadas. Trabaja el pecho inferior sin equipo."},
  {id:"e097",name:"Flexiones Declinadas",        muscle:["pecho","hombros"],  equip:"Sin equipo",level:"Principiante", xpBase:32, desc:"Pies elevados. Mayor activación de pecho superior y hombros."},
  {id:"e098",name:"Press Banca con Agarre Neutro",muscle:["pecho","triceps"], equip:"Mancuernas",level:"Intermedio",   xpBase:43, desc:"Palmas enfrentadas. Menos estrés en muñecas y hombros."},

  // ── ESPALDA EXTRA ────────────────────────────────────────────────────────────
  {id:"e099",name:"Remo en Polea Baja",          muscle:["espalda","biceps"], equip:"Polea",     level:"Principiante", xpBase:42, desc:"Cable Row sentado. Tensión constante en dorsal y romboides."},
  {id:"e100",name:"Remo en Máquina",             muscle:["espalda"],          equip:"Máquina",   level:"Principiante", xpBase:40, desc:"Remo en máquina. Seguro y efectivo para principiantes."},
  {id:"e101",name:"Jalones con Agarre Neutro",   muscle:["espalda","biceps"], equip:"Polea",     level:"Principiante", xpBase:42, desc:"Agarre paralelo en jalón. Mayor activación del dorsal bajo."},
  {id:"e102",name:"Jalones al Pecho Agarre Cerrado",muscle:["espalda"],       equip:"Polea",     level:"Principiante", xpBase:40, desc:"Jalón con agarre estrecho supino. Gran rango de recorrido."},
  {id:"e103",name:"Encogimientos con Barra",     muscle:["espalda","hombros"],equip:"Barra",     level:"Principiante", xpBase:30, desc:"Shrugs. Trabaja el trapecio superior."},
  {id:"e104",name:"Encogimientos con Mancuernas",muscle:["espalda","hombros"],equip:"Mancuernas",level:"Principiante", xpBase:28, desc:"Shrugs con mancuernas. Más rango que con barra."},
  {id:"e105",name:"Hiperextensiones",            muscle:["espalda","gluteos"],equip:"Máquina",   level:"Principiante", xpBase:32, desc:"Back Extension. Lumbar y glúteos en banco romano."},
  {id:"e106",name:"Superman",                    muscle:["espalda","gluteos"],equip:"Sin equipo",level:"Principiante", xpBase:20, desc:"Tumbado boca abajo. Fortalece la cadena posterior sin equipo."},
  {id:"e107",name:"Remo con Barra Underhand",    muscle:["espalda","biceps"], equip:"Barra",     level:"Intermedio",   xpBase:47, desc:"Remo con agarre supino. Mayor activación de bíceps y dorsal bajo."},
  {id:"e108",name:"Dominadas con Agarre Neutro", muscle:["espalda","biceps"], equip:"Barra",     level:"Intermedio",   xpBase:57, desc:"Chin-up neutro. Menos estrés en muñecas y hombros."},
  {id:"e109",name:"Chin-Up",                     muscle:["espalda","biceps"], equip:"Barra",     level:"Intermedio",   xpBase:55, desc:"Dominadas con agarre supino. Mayor activación de bíceps."},

  // ── HOMBROS EXTRA ────────────────────────────────────────────────────────────
  {id:"e110",name:"Press Máquina Hombros",       muscle:["hombros"],          equip:"Máquina",   level:"Principiante", xpBase:40, desc:"Press en máquina. Ideal para aprender el patrón de empuje vertical."},
  {id:"e111",name:"Elevaciones Laterales en Polea",muscle:["hombros"],        equip:"Polea",     level:"Principiante", xpBase:30, desc:"Tensión constante en deltoides lateral vs mancuernas."},
  {id:"e112",name:"Press Z (Landmine Press)",    muscle:["hombros","pecho"],  equip:"Barra",     level:"Intermedio",   xpBase:48, desc:"Press en landmine. Plano de movimiento único, amigable con hombros."},
  {id:"e113",name:"Lateral Raise Inclinado",     muscle:["hombros"],          equip:"Mancuernas",level:"Intermedio",   xpBase:32, desc:"Elevación lateral tumbado en banco inclinado. Máxima tensión en deltoides."},
  {id:"e114",name:"Pájaros",                     muscle:["hombros","espalda"],equip:"Mancuernas",level:"Principiante", xpBase:28, desc:"Reverse Fly. Deltoides posterior e infraespinoso."},

  // ── PIERNAS EXTRA ────────────────────────────────────────────────────────────
  {id:"e115",name:"Sentadilla Sumo",             muscle:["piernas","gluteos"], equip:"Barra",    level:"Intermedio",   xpBase:55, desc:"Stance ancho. Mayor activación de aductores e isquiotibiales."},
  {id:"e116",name:"Sentadilla Sissy",            muscle:["piernas"],           equip:"Sin equipo",level:"Avanzado",    xpBase:45, desc:"Sissy Squat. Aislamiento extremo del cuádriceps."},
  {id:"e117",name:"Curl Femoral de Pie",         muscle:["piernas"],           equip:"Máquina",  level:"Principiante", xpBase:28, desc:"Isquiotibiales de pie en máquina. Posición más funcional."},
  {id:"e118",name:"Zancadas con Barra",          muscle:["piernas","gluteos"], equip:"Barra",    level:"Intermedio",   xpBase:50, desc:"Lunges con barra. Mayor carga y demanda de estabilidad."},
  {id:"e119",name:"Zancadas Estáticas",          muscle:["piernas","gluteos"], equip:"Mancuernas",level:"Principiante",xpBase:40, desc:"Split Squat. Posición fija para trabajar pierna por pierna."},
  {id:"e120",name:"Leg Press Unilateral",        muscle:["piernas","gluteos"], equip:"Máquina",  level:"Intermedio",   xpBase:45, desc:"Prensa a una pierna. Corrección de desequilibrios musculares."},
  {id:"e121",name:"Sentadilla en Cajón",         muscle:["piernas","gluteos"], equip:"Barra",    level:"Principiante", xpBase:48, desc:"Box Squat. Refuerza la fase excéntrica y mejora la profundidad."},
  {id:"e122",name:"Good Morning",               muscle:["espalda","piernas"], equip:"Barra",    level:"Intermedio",   xpBase:50, desc:"Bisagra de cadera con barra. Isquiotibiales y lumbar bajo carga."},
  {id:"e123",name:"Peso Muerto con Mancuernas", muscle:["piernas","espalda"], equip:"Mancuernas",level:"Principiante",xpBase:45, desc:"Deadlift con mancuernas. Ideal para aprender el patrón de bisagra."},
  {id:"e124",name:"Abducción de Cadera con Goma",muscle:["gluteos"],          equip:"Goma",     level:"Principiante", xpBase:25, desc:"Glúteo medio con banda elástica. Activación y calentamiento."},
  {id:"e125",name:"Elevación de Cadera Unilateral",muscle:["gluteos"],        equip:"Sin equipo",level:"Principiante",xpBase:30, desc:"Glute Bridge a una pierna. Activación de glúteo y core."},
  {id:"e126",name:"Rumble Roller Hip Thrust",    muscle:["gluteos","piernas"],equip:"Sin equipo",level:"Principiante", xpBase:32, desc:"Hip Thrust en suelo sin equipo. Glúteo y femoral juntos."},

  // ── BÍCEPS EXTRA ─────────────────────────────────────────────────────────────
  {id:"e127",name:"Curl en Polea Baja",          muscle:["biceps"],           equip:"Polea",     level:"Principiante", xpBase:32, desc:"Tensión constante en bíceps desde la parte baja."},
  {id:"e128",name:"Curl 21",                     muscle:["biceps"],           equip:"Barra",     level:"Intermedio",   xpBase:40, desc:"21 repeticiones parciales. Alta congestión y quema en bíceps."},
  {id:"e129",name:"Curl Araña",                  muscle:["biceps"],           equip:"Banco",     level:"Intermedio",   xpBase:36, desc:"Spider Curl. Bíceps apoyados en banco inclinado, elimina el swing."},
  {id:"e130",name:"Curl Zottman",                muscle:["biceps","antebrazos"],equip:"Mancuernas",level:"Intermedio", xpBase:35, desc:"Sube en supinación, baja en pronación. Trabaja toda la flexión del codo."},

  // ── TRÍCEPS EXTRA ────────────────────────────────────────────────────────────
  {id:"e131",name:"Press Francés con Mancuernas",muscle:["triceps"],          equip:"Mancuernas",level:"Intermedio",   xpBase:38, desc:"Skull Crusher con mancuernas. Más rango y control unilateral."},
  {id:"e132",name:"Extensión Polea Cuerda Cabeza",muscle:["triceps"],         equip:"Polea",     level:"Principiante", xpBase:34, desc:"Extensión sobre cabeza en polea. Cabeza larga del tríceps."},
  {id:"e133",name:"Fondos en Silla",             muscle:["triceps"],          equip:"Sin equipo",level:"Principiante", xpBase:28, desc:"Dips en silla. Tríceps y pecho inferior sin equipo."},
  {id:"e134",name:"Kickback con Mancuerna",      muscle:["triceps"],          equip:"Mancuernas",level:"Principiante", xpBase:28, desc:"Extensión de tríceps hacia atrás. Aislamiento de cabeza larga."},
  {id:"e135",name:"Kickback en Polea",           muscle:["triceps"],          equip:"Polea",     level:"Principiante", xpBase:29, desc:"Kickback con tensión constante de cable. Mejor que con mancuerna."},

  // ── ABDOMEN EXTRA ────────────────────────────────────────────────────────────
  {id:"e136",name:"Crunch Inverso",              muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:28, desc:"Reverse Crunch. Abdomen bajo elevando caderas del suelo."},
  {id:"e137",name:"Bicycle Crunch",              muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:28, desc:"Rotación codo-rodilla. Recto y oblicuos juntos."},
  {id:"e138",name:"Toe Touch",                   muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante", xpBase:22, desc:"Crunch con piernas en vertical. Abdomen superior."},
  {id:"e139",name:"Mountain Climbers",           muscle:["abdomen","cardio"], equip:"Sin equipo",level:"Principiante", xpBase:35, desc:"Escalador. Core y cardio simultáneo. Ideal en circuitos."},
  {id:"e140",name:"Hollow Body Hold",            muscle:["abdomen"],          equip:"Sin equipo",level:"Intermedio",   xpBase:30, desc:"Posición gimanástica. Core total bajo tensión isométrica."},
  {id:"e141",name:"Dragon Flag",                 muscle:["abdomen"],          equip:"Banco",     level:"Avanzado",     xpBase:55, desc:"El ejercicio de core más difícil. Básico de la gimnasia."},
  {id:"e142",name:"Pallof Press",                muscle:["abdomen"],          equip:"Polea",     level:"Principiante", xpBase:28, desc:"Anti-rotación en polea. Core estabilizador funcional."},
  {id:"e143",name:"Crunch en Máquina",           muscle:["abdomen"],          equip:"Máquina",   level:"Principiante", xpBase:28, desc:"Crunch con carga ajustable. Ideal para sobrecargar el abdomen."},

  // ── CARDIO / FUNCIONAL EXTRA ─────────────────────────────────────────────────
  {id:"e144",name:"Kettlebell Swing",            muscle:["cardio","gluteos","espalda"],equip:"Kettlebell",level:"Intermedio",xpBase:55,desc:"Swing de kettlebell. Explosión de cadera, cardio y cadena posterior."},
  {id:"e145",name:"Box Jump",                    muscle:["piernas","cardio"], equip:"Sin equipo",level:"Intermedio",   xpBase:50, desc:"Salto al cajón. Potencia y explosividad de piernas."},
  {id:"e146",name:"Jump Squat",                  muscle:["piernas","cardio"], equip:"Sin equipo",level:"Principiante", xpBase:40, desc:"Sentadilla con salto. Potencia y quema calórica alta."},
  {id:"e147",name:"Thruster",                    muscle:["piernas","hombros","cardio"],equip:"Barra",level:"Avanzado",  xpBase:70, desc:"Sentadilla + Press Militar. Ejercicio total body de alta intensidad."},
  {id:"e148",name:"Clean and Press",             muscle:["piernas","espalda","hombros"],equip:"Barra",level:"Avanzado", xpBase:75, desc:"Levantamiento olímpico simplificado. Explosión y fuerza completa."},
  {id:"e149",name:"Battle Ropes",                muscle:["cardio","hombros"], equip:"Cuerdas",   level:"Intermedio",   xpBase:60, desc:"Ondas con cuerdas de batalla. Cardio y fuerza de hombros."},
  {id:"e150",name:"Sled Push",                   muscle:["cardio","piernas"], equip:"Trineo",    level:"Intermedio",   xpBase:65, desc:"Empuje de trineo. Potencia de piernas y cardio metabólico."},
  {id:"e151",name:"Farmer's Carry",              muscle:["antebrazos","hombros","cardio"],equip:"Mancuernas",level:"Principiante",xpBase:38,desc:"Marcha cargado. Fuerza de agarre, core y resistencia funcional."},
  {id:"e152",name:"Wall Ball",                   muscle:["piernas","hombros","cardio"],equip:"Balón",level:"Principiante",xpBase:45,desc:"Lanzamiento de balón medicinal a pared. Potencia y cardio."},
  {id:"e153",name:"Salto de Tijera (Jumping Jack)",muscle:["cardio"],         equip:"Sin equipo",level:"Principiante", xpBase:25, desc:"Cardio básico de calentamiento. Activa todo el cuerpo."},

  // ── MOVILIDAD / STRETCHING ACTIVO ────────────────────────────────────────────
  {id:"e154",name:"Hip Flexor Stretch",          muscle:["piernas","gluteos"],equip:"Sin equipo",level:"Principiante", xpBase:15, desc:"Estiramiento activo de flexor de cadera. Esencial post-entreno."},
  {id:"e155",name:"Cat-Cow",                     muscle:["espalda","abdomen"],equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"Movilidad de columna. Ideal como calentamiento o cooldown."},
  {id:"e156",name:"Pigeon Pose",                 muscle:["gluteos","piernas"],equip:"Sin equipo",level:"Principiante", xpBase:15, desc:"Apertura profunda de cadera. Libera tensión de glúteo y piriforme."},
  {id:"e157",name:"Thoracic Rotation",           muscle:["espalda"],          equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"Rotación torácica. Movilidad de espalda alta, esencial en press."},
  {id:"e158",name:"World's Greatest Stretch",    muscle:["piernas","espalda","hombros"],equip:"Sin equipo",level:"Principiante",xpBase:18,desc:"Estiramiento global. Cadera, torácica y hombros en un movimiento."},
  {id:"e159",name:"Ankle Mobility Drill",        muscle:["gemelos","piernas"],equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"Movilidad de tobillo. Clave para profundidad en sentadilla."},

  // ── MÁQUINAS ADICIONALES ─────────────────────────────────────────────────────
  {id:"e160",name:"Aductores en Máquina",        muscle:["piernas"],          equip:"Máquina",   level:"Principiante", xpBase:25, desc:"Inner thigh machine. Trabaja aductores de la cadera."},
  {id:"e161",name:"Hip Extension en Máquina",    muscle:["gluteos"],          equip:"Máquina",   level:"Principiante", xpBase:30, desc:"Extensión de cadera en máquina. Activación directa del glúteo mayor."},
  {id:"e162",name:"Chest Supported Row",         muscle:["espalda"],          equip:"Máquina",   level:"Principiante", xpBase:42, desc:"Remo con pecho apoyado. Sin trampa de inercia. Máximo aislamiento dorsal."},
  {id:"e163",name:"Leg Curl Sentado",            muscle:["piernas"],          equip:"Máquina",   level:"Principiante", xpBase:30, desc:"Curl de isquios sentado. Diferente ángulo que tumbado, más efectivo."},
  {id:"e164",name:"Pec Deck Inverso",            muscle:["hombros","espalda"],equip:"Máquina",   level:"Principiante", xpBase:28, desc:"Apertura inversa en máquina. Deltoides posterior y romboides."},
  {id:"e165",name:"Smith Machine Sentadilla",    muscle:["piernas","gluteos"],equip:"Máquina",   level:"Principiante", xpBase:45, desc:"Sentadilla guiada en Smith. Segura para aprender el patrón."},
  {id:"e166",name:"Smith Machine Press Banca",   muscle:["pecho","triceps"],  equip:"Máquina",   level:"Principiante", xpBase:42, desc:"Press de banca en Smith Machine. Control total del movimiento."},

  // ── DEL LIBRO: PECTORAL ──────────────────────────────────────────────────────
  {id:"e167",name:"Press Banca Declinado Mancuernas", muscle:["pecho"],       equip:"Mancuernas",level:"Intermedio",   xpBase:40, desc:"Pecho inferior con mancuernas. Más rango y rotación que con barra declinado."},
  {id:"e168",name:"Pull-Over con Barra",          muscle:["pecho","espalda"], equip:"Barra",     level:"Intermedio",   xpBase:42, desc:"Pull-over con barra en banco. Estiramiento profundo de pecho y dorsal."},
  {id:"e169",name:"Cruce de Poleas Alto",         muscle:["pecho"],           equip:"Polea",     level:"Principiante", xpBase:35, desc:"Cable crossover desde polea alta. Pecho inferior con tensión constante."},
  {id:"e170",name:"Cruce de Poleas Bajo",         muscle:["pecho"],           equip:"Polea",     level:"Principiante", xpBase:35, desc:"Cable crossover desde polea baja. Activa la parte superior del pecho."},
  {id:"e171",name:"Contractor Pectoral",          muscle:["pecho"],           equip:"Máquina",   level:"Principiante", xpBase:33, desc:"Pec-Deck. Aislamiento completo de pecho con movimiento de apertura y cierre."},

  // ── DEL LIBRO: DORSAL ────────────────────────────────────────────────────────
  {id:"e172",name:"Jalón Tras Nuca",              muscle:["espalda"],         equip:"Polea",     level:"Intermedio",   xpBase:42, desc:"Jalón llevando la barra detrás de la cabeza. Mayor activación del trapecio medio."},
  {id:"e173",name:"Remo en Punta",                muscle:["espalda","antebrazos"],equip:"Barra", level:"Intermedio",   xpBase:46, desc:"T-Bar Row libre. Barra anclada en esquina, excelente para el grosor dorsal."},
  {id:"e174",name:"Remo en Polea Alta",           muscle:["espalda","biceps"],equip:"Polea",     level:"Principiante", xpBase:40, desc:"Remo tirando desde polea alta. Trabaja dorsal y romboides con ángulo diferente."},
  {id:"e175",name:"Jalón Sentado en Suelo",       muscle:["espalda","biceps"],equip:"Polea",     level:"Principiante", xpBase:40, desc:"Jalón en polea baja sentado en el suelo. Recorrido completo para el dorsal."},
  {id:"e176",name:"Remo en Multipower",           muscle:["espalda"],         equip:"Máquina",   level:"Principiante", xpBase:44, desc:"Remo en Smith Machine. Guiado y seguro, ideal para trabajar la espalda media."},

  // ── DEL LIBRO: HOMBROS ───────────────────────────────────────────────────────
  {id:"e177",name:"Press Militar Tras Nuca",      muscle:["hombros","espalda"],equip:"Barra",    level:"Avanzado",     xpBase:52, desc:"Press detrás de la cabeza. Mayor activación del deltoides posterior y trapecio."},
  {id:"e178",name:"Press Arnold Sentado",         muscle:["hombros"],         equip:"Mancuernas",level:"Intermedio",   xpBase:48, desc:"Press Arnold clásico sentado. Giro de supinación a pronación activa más fibras."},
  {id:"e179",name:"Elevaciones Laterales Tumbado",muscle:["hombros"],         equip:"Mancuernas",level:"Principiante", xpBase:30, desc:"Abducción lateral tumbado en banco. Elimina el impulso y aísla el deltoides."},
  {id:"e180",name:"Pájaros Sentado",              muscle:["hombros","espalda"],equip:"Mancuernas",level:"Principiante",xpBase:28, desc:"Elevaciones posteriores sentado con tronco inclinado. Deltoides posterior y romboides."},
  {id:"e181",name:"Remo al Cuello Mancuernas",   muscle:["hombros","espalda"],equip:"Mancuernas",level:"Principiante", xpBase:35, desc:"Upright row con mancuernas. Agarre más natural y menor estrés en muñecas que con barra."},
  {id:"e182",name:"Pájaros en Polea",             muscle:["hombros","espalda"],equip:"Polea",    level:"Principiante", xpBase:30, desc:"Elevaciones posteriores en polea baja a una mano. Tensión constante en deltoides posterior."},
  {id:"e183",name:"Press Militar en Multipower",  muscle:["hombros"],         equip:"Máquina",   level:"Principiante", xpBase:50, desc:"Press militar en Smith Machine. Movimiento guiado, bueno para aprender el patrón."},
  {id:"e184",name:"Rotaciones Externas Hombro",   muscle:["hombros","espalda"],equip:"Mancuernas",level:"Principiante",xpBase:20, desc:"Rotación externa tumbado. Ejercicio de salud para el manguito rotador."},
  {id:"e185",name:"Rotaciones Internas Hombro",   muscle:["hombros"],         equip:"Mancuernas",level:"Principiante", xpBase:20, desc:"Rotación interna tumbado. Fortalece el subescapular y protege el hombro."},

  // ── DEL LIBRO: BÍCEPS ────────────────────────────────────────────────────────
  {id:"e186",name:"Curl con Barra Z",             muscle:["biceps","antebrazos"],equip:"Barra",  level:"Principiante", xpBase:36, desc:"Curl con barra EZ. Posición de muñeca más natural que con barra recta."},
  {id:"e187",name:"Curl Tumbado",                 muscle:["biceps"],           equip:"Barra",    level:"Intermedio",   xpBase:35, desc:"Curl con barra o mancuernas tumbado en banco. Elimina completamente el balanceo."},
  {id:"e188",name:"Curl en Polea Alta",           muscle:["biceps"],           equip:"Polea",    level:"Intermedio",   xpBase:35, desc:"High cable curl a una mano. Tensión en la posición contraída del bíceps."},
  {id:"e189",name:"Curl Scott con Mancuerna",     muscle:["biceps"],           equip:"Mancuernas",level:"Intermedio",  xpBase:38, desc:"Predicador unilateral con mancuerna. Mayor rango y control que con barra."},

  // ── DEL LIBRO: TRÍCEPS ───────────────────────────────────────────────────────
  {id:"e190",name:"Press Francés con Barra Z",    muscle:["triceps"],          equip:"Barra",    level:"Intermedio",   xpBase:40, desc:"Skull crusher con barra EZ. Menos estrés en muñecas que con barra recta."},
  {id:"e191",name:"Extensión Polea Cuerda Alta",  muscle:["triceps"],          equip:"Polea",    level:"Principiante", xpBase:33, desc:"Push-down con cuerda. La separación final activa las tres cabezas del tríceps."},
  {id:"e192",name:"Extensión Polea Invertida",    muscle:["triceps"],          equip:"Polea",    level:"Principiante", xpBase:30, desc:"Push-down con agarre supino. Mayor activación de la cabeza larga del tríceps."},
  {id:"e193",name:"Press Francés en Polea",       muscle:["triceps"],          equip:"Polea",    level:"Intermedio",   xpBase:38, desc:"Lying triceps extension en polea baja. Tensión constante durante todo el movimiento."},
  {id:"e194",name:"Patadas de Tríceps con Giro",  muscle:["triceps"],          equip:"Mancuernas",level:"Principiante",xpBase:29, desc:"Kickback con giro de muñeca. Activa la porción lateral del tríceps con supinación final."},

  // ── DEL LIBRO: ANTEBRAZOS ────────────────────────────────────────────────────
  {id:"e195",name:"Flexiones de Muñeca Sentado",  muscle:["antebrazos"],       equip:"Barra",    level:"Principiante", xpBase:24, desc:"Wrist curl con barra sentado. Flexores del antebrazo con apoyo en muslos."},
  {id:"e196",name:"Enrollamiento de Cuerda",      muscle:["antebrazos"],       equip:"Barra",    level:"Principiante", xpBase:28, desc:"Wrist roller. Enrollar y desenrollar peso colgado de una barra. Fuerza de agarre total."},
  {id:"e197",name:"Curl en Pronación",            muscle:["antebrazos","biceps"],equip:"Barra",  level:"Principiante", xpBase:30, desc:"Reverse curl con barra. Trabaja el braquiorradial y extensores del antebrazo."},

  // ── DEL LIBRO: PIERNAS ───────────────────────────────────────────────────────
  {id:"e198",name:"Sentadilla Hack con Barra",    muscle:["piernas"],          equip:"Barra",    level:"Avanzado",     xpBase:60, desc:"Hack squat con barra detrás. Clásico de la halterofilia, gran activación de cuádriceps."},
  {id:"e199",name:"Escalón con Mancuernas",       muscle:["piernas","gluteos"],equip:"Mancuernas",level:"Principiante",xpBase:36, desc:"Step-up con mancuernas. Funcional, trabaja cada pierna por separado."},
  {id:"e200",name:"Zancadas Laterales",           muscle:["piernas","gluteos"],equip:"Mancuernas",level:"Principiante",xpBase:38, desc:"Lateral lunge. Aductores e isquiotibiales con movimiento en plano frontal."},
  {id:"e201",name:"Peso Muerto sobre Escalón",    muscle:["piernas","espalda"],equip:"Barra",    level:"Avanzado",     xpBase:65, desc:"Deficit deadlift. Mayor rango de movimiento para isquios y glúteos."},
  {id:"e202",name:"Elevación de Talones Burro",   muscle:["gemelos"],          equip:"Máquina",  level:"Principiante", xpBase:28, desc:"Donkey calf raise. Posición inclinada con mayor estiramiento del gastrocnemio."},
  {id:"e203",name:"Patadas de Glúteo Tumbado",    muscle:["gluteos"],          equip:"Sin equipo",level:"Principiante",xpBase:25, desc:"Donkey kick. Extensión de cadera tumbado en cuadrupedia. Glúteo mayor en aislamiento."},
  {id:"e204",name:"Abducción de Cadera de Pie",   muscle:["gluteos","piernas"],equip:"Sin equipo",level:"Principiante",xpBase:22, desc:"Standing hip abduction. Elevación lateral de pierna de pie. Glúteo medio."},
  {id:"e205",name:"Aducción de Cadera de Pie",    muscle:["piernas"],          equip:"Sin equipo",level:"Principiante",xpBase:22, desc:"Standing hip adduction. Cruce de pierna de pie. Aductores internos."},
  {id:"e206",name:"Glúteos en Multipolea",        muscle:["gluteos"],          equip:"Polea",    level:"Principiante", xpBase:32, desc:"Cable kick-back. Extensión de cadera en polea baja de pie. Glúteo mayor."},
  {id:"e207",name:"Extensiones de Cuádriceps Polea",muscle:["piernas"],        equip:"Polea",    level:"Principiante", xpBase:30, desc:"Leg extension en polea baja. Alternativa a la máquina con tensión dinámica."},

  // ── DEL LIBRO: ABDOMEN Y LUMBAR ──────────────────────────────────────────────
  {id:"e208",name:"Crunch Declinado",             muscle:["abdomen"],          equip:"Banco",    level:"Intermedio",   xpBase:30, desc:"Crunch en banco declinado. Mayor rango de movimiento para el recto abdominal."},
  {id:"e209",name:"Elevación de Tronco Romana",   muscle:["abdomen"],          equip:"Máquina",  level:"Principiante", xpBase:28, desc:"Sit-up en silla romana. Trabajo completo del abdomen con anclaje de pies."},
  {id:"e210",name:"Elevaciones de Piernas Colgado",muscle:["abdomen"],         equip:"Barra",    level:"Intermedio",   xpBase:40, desc:"Hanging leg raise. Abdomen bajo con el cuerpo suspendido en barra. Alta demanda de core."},
  {id:"e211",name:"Rodillas al Pecho Colgado",    muscle:["abdomen"],          equip:"Barra",    level:"Principiante", xpBase:32, desc:"Hanging knee raise. Versión más accesible del colgado. Abdomen bajo e iliopsoas."},
  {id:"e212",name:"Patada de Rana",               muscle:["abdomen"],          equip:"Sin equipo",level:"Principiante",xpBase:28, desc:"Frog kick / jack-knife. Combina elevación de tronco y piernas simultáneamente."},
  {id:"e213",name:"Giros con Barra",              muscle:["abdomen"],          equip:"Barra",    level:"Principiante", xpBase:22, desc:"Twists con barra sobre los hombros. Rotación de tronco para oblicuos."},
  {id:"e214",name:"Inclinaciones Laterales",      muscle:["abdomen"],          equip:"Mancuernas",level:"Principiante",xpBase:24, desc:"Side bend con mancuerna. Flexión lateral de tronco para oblicuo externo."},
  {id:"e215",name:"Crunch en Polea Alta",         muscle:["abdomen"],          equip:"Polea",    level:"Principiante", xpBase:30, desc:"Cable crunch de rodillas. Alta activación del recto abdominal con carga ajustable."},
  {id:"e216",name:"Extensiones de Tronco Lumbar", muscle:["espalda"],          equip:"Máquina",  level:"Principiante", xpBase:30, desc:"Back extension en máquina lumbar. Fortalece erector espinal y multífidos."},
  {id:"e217",name:"Peso Muerto Buenos Días",      muscle:["espalda","piernas"],equip:"Barra",    level:"Intermedio",   xpBase:48, desc:"Good morning con barra. Bisagra de cadera con barra alta. Lumbar e isquiotibiales."},

  // ── MOVILIDAD Y CALENTAMIENTO ─────────────────────────────────────────────────
  {id:"e218",name:"Sentadilla de Movilidad",      muscle:["piernas","gluteos"],equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"Squat to stand. Baja y mantén la posición para abrir cadera y movilizar tobillo."},
  {id:"e219",name:"Apertura de Cadera en Suelo",  muscle:["gluteos","piernas"],equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"90/90 hip stretch. Ambas rodillas a 90°. Movilidad interna y externa de cadera."},
  {id:"e220",name:"Rotacion de Cadera de Pie",    muscle:["gluteos","piernas"],equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Hip circle de pie. Circulos con la cadera para lubricar la articulacion coxofemoral."},
  {id:"e221",name:"Estiramiento de Isquiotibiales",muscle:["piernas"],        equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"Hamstring stretch. Tumbado o de pie, estiramiento activo de la cadena posterior."},
  {id:"e222",name:"Estiramiento de Cuadriceps",   muscle:["piernas"],          equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Quad stretch de pie. Talon al gluteo. Esencial post-entreno de piernas."},
  {id:"e223",name:"Estiramiento de Gemelo",       muscle:["gemelos"],          equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Calf stretch en pared. Gastrocnemio y soleo. Previene contracturas y lesiones."},
  {id:"e224",name:"Estiramiento de Pectoral",     muscle:["pecho","hombros"],  equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Chest stretch en puerta. Abre el pecho tras press y ejercicios de empuje."},
  {id:"e225",name:"Estiramiento de Dorsal",       muscle:["espalda"],          equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Lat stretch colgado o con apoyo. Alarga el dorsal ancho despues de jalones y remos."},
  {id:"e226",name:"Estiramiento de Triceps",      muscle:["triceps"],          equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Triceps stretch sobre la cabeza. Brazo cruzado o una mano a la espalda."},
  {id:"e227",name:"Estiramiento de Hombro Cruzado",muscle:["hombros"],        equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Cross-body shoulder stretch. Brazo cruzado al pecho. Deltoides posterior y manguito."},
  {id:"e228",name:"Cobra",                        muscle:["espalda","abdomen"],equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"Cobra pose. Extension lumbar en suelo. Movilidad y descompresion de columna."},
  {id:"e229",name:"Child's Pose",                 muscle:["espalda","hombros"],equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Postura del nino. Elongacion completa de columna y hombros. Ideal al final de sesion."},
  {id:"e230",name:"Rotacion de Columna Tumbado",  muscle:["espalda","abdomen"],equip:"Sin equipo",level:"Principiante", xpBase:12, desc:"Spinal twist tumbado. Rodillas al pecho y giro lateral. Libera tension lumbar."},
  {id:"e231",name:"Movilidad de Muneca",          muscle:["antebrazos"],       equip:"Sin equipo",level:"Principiante", xpBase:8,  desc:"Circulos y extensiones de muneca. Clave antes de press y ejercicios de empuje."},
  {id:"e232",name:"Apertura Toracica en Banco",   muscle:["espalda","pecho"],  equip:"Banco",     level:"Principiante", xpBase:12, desc:"Thoracic extension sobre banco. Zona dorsal apoyada, brazos abiertos. Mejora postura."},
  {id:"e233",name:"Inchworm",                     muscle:["espalda","piernas","hombros"],equip:"Sin equipo",level:"Principiante",xpBase:18,desc:"Gusano. Caminar con las manos desde los pies. Movilidad global de cadena posterior."},
  {id:"e234",name:"Leg Swing Frontal",            muscle:["piernas","gluteos"],equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Pendulo frontal de pierna. Movilidad dinamica de cadera. Calentamiento pre-piernas."},
  {id:"e235",name:"Leg Swing Lateral",            muscle:["piernas","gluteos"],equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Pendulo lateral de pierna. Movilidad de abductores y aductores. Activa gluteo medio."},
  {id:"e236",name:"Shoulder Pass-Through",        muscle:["hombros","espalda"],equip:"Barra",     level:"Principiante", xpBase:12, desc:"Palo detras de la espalda agarre ancho. Movilidad completa de hombro, previene lesiones."},
  {id:"e237",name:"Foam Roller Espalda",          muscle:["espalda"],          equip:"Sin equipo",level:"Principiante", xpBase:10, desc:"Rodillo de espuma en columna. Libera tension toracica y mejora la extension de espalda."},
];


const MUSCLE_MAP = Object.fromEntries(EXERCISE_DB.map(e=>[e.name, e.muscle]));


// ─── RAID DATABASE ────────────────────────────────────────────────────────────
const RAID_DB = [
  // ── FUEGO ──────────────────────────────────────────────────────────────────
  {id:"r01", boss:"Ignis, el Devorador de Almas",    icon:"🔥", rarity:"épica",
   desc:"El Señor del Fuego exige que te consumas en llamas.",
   challenge:"100 Burpees", reps:100, exercise:"Burpees",
   xp:400, coins:150, time:86400},
  {id:"r02", boss:"Pyros, la Llama Eterna",   icon:"🔥", rarity:"legendaria",
   desc:"Su calor no perdona la debilidad. Demuestra que puedes con todo.",
   challenge:"150 Mountain Climbers", reps:150, exercise:"Mountain Climbers",
   xp:600, coins:250, time:86400},
  {id:"r03", boss:"Emberstrike, la Chispa Maldita",           icon:"🔥", rarity:"normal",
   desc:"Un destello de fuego. Rápido, intenso, sin descanso.",
   challenge:"50 Burpees", reps:50, exercise:"Burpees",
   xp:200, coins:75, time:86400},

  // ── HIELO ──────────────────────────────────────────────────────────────────
  {id:"r04", boss:"Glacius, el Implacable", icon:"❄️", rarity:"épica",
   desc:"El frío paraliza a los débiles. Caliéntate con sudor.",
   challenge:"200 Sentadillas", reps:200, exercise:"Sentadillas",
   xp:450, coins:175, time:86400},
  {id:"r05", boss:"Frostbane, el Azote Helado",             icon:"❄️", rarity:"normal",
   desc:"Un viento helado que congela los músculos. Rómpelo.",
   challenge:"75 Flexiones", reps:75, exercise:"Flexiones",
   xp:220, coins:80, time:86400},
  {id:"r06", boss:"Tundra, la Eterna Tempestad",      icon:"❄️", rarity:"legendaria",
   desc:"La tormenta de hielo más brutal del reino. ¿Te atreves?",
   challenge:"300 Mountain Climbers", reps:300, exercise:"Mountain Climbers",
   xp:700, coins:300, time:86400},

  // ── TRUENO ─────────────────────────────────────────────────────────────────
  {id:"r07", boss:"Zephyr, Señor del Trueno",      icon:"⚡", rarity:"épica",
   desc:"La velocidad del rayo. No hay tiempo para descansar.",
   challenge:"100 Jumping Jacks + 50 Burpees", reps:150, exercise:"Jumping Jacks",
   xp:500, coins:200, time:86400},
  {id:"r08", boss:"Stormcaller, Invocador de Tormentas",           icon:"⚡", rarity:"normal",
   desc:"Una tormenta eléctrica de abdominales. Sin piedad.",
   challenge:"100 Crunches", reps:100, exercise:"Crunches",
   xp:180, coins:65, time:86400},
  {id:"r09", boss:"Voltex, Rey del Rayo Absoluto",  icon:"⚡", rarity:"legendaria",
   desc:"El poder absoluto del trueno en tus músculos.",
   challenge:"100 Burpees + 100 Flexiones", reps:200, exercise:"Burpees + Flexiones",
   xp:800, coins:350, time:86400},

  // ── OSCURIDAD ──────────────────────────────────────────────────────────────
  {id:"r10", boss:"Shadowmere, el Susurro Oscuro",            icon:"🌑", rarity:"normal",
   desc:"Desde las sombras, el dolor llega sin avisar.",
   challenge:"60 Flexiones", reps:60, exercise:"Flexiones",
   xp:200, coins:75, time:86400},
  {id:"r11", boss:"Void, el Devorador del Vacío",     icon:"🌑", rarity:"épica",
   desc:"El vacío absorbe tu energía. Dale más de lo que puede tomar.",
   challenge:"150 Abdominales", reps:150, exercise:"Abdominales",
   xp:420, coins:160, time:86400},
  {id:"r12", boss:"Nyx, Reina de la Eterna Noche",   icon:"🌑", rarity:"legendaria",
   desc:"La oscuridad más profunda. Solo los más fuertes ven la luz.",
   challenge:"50 Burpees + 100 Sentadillas + 50 Flexiones", reps:200, exercise:"Full Body",
   xp:900, coins:400, time:86400},

  // ── TIERRA ─────────────────────────────────────────────────────────────────
  {id:"r13", boss:"Krag, la Roca Viviente", icon:"🪨", rarity:"normal",
   desc:"Nacido del corazón de la montaña. Su piel es piedra, su voluntad es acero.",
   challenge:"80 Sentadillas + 40 Flexiones", reps:120, exercise:"Sentadillas + Flexiones",
   xp:230, coins:85, time:86400},
  {id:"r14", boss:"Terradon, el Sacudidor de Mundos",              icon:"🪨", rarity:"épica",
   desc:"La tierra tiembla bajo su peso. Hazla temblar tú también.",
   challenge:"200 Abdominales", reps:200, exercise:"Abdominales",
   xp:460, coins:180, time:86400},
  {id:"r15", boss:"Moloch, el Coloso de Barro", icon:"🪨", rarity:"legendaria",
   desc:"Antiguo como la tierra. Cada golpe suyo hunde montañas. Hoy tú eres la montaña.",
   challenge:"150 Burpees + 150 Sentadillas + 100 Flexiones", reps:400, exercise:"The Colossus",
   xp:950, coins:425, time:86400},

  // ── VENENO ─────────────────────────────────────────────────────────────────
  {id:"r16", boss:"Venom, el Corrompido Eterno",   icon:"☠️", rarity:"normal",
   desc:"El veneno debilita. Supera el dolor y gana.",
   challenge:"80 Mountain Climbers", reps:80, exercise:"Mountain Climbers",
   xp:185, coins:68, time:86400},
  {id:"r17", boss:"Toxicus, Heraldo de la Plaga",               icon:"☠️", rarity:"épica",
   desc:"El veneno más letal. Solo los inmunes sobreviven.",
   challenge:"120 Burpees", reps:120, exercise:"Burpees",
   xp:500, coins:200, time:86400},

  // ── DRAGÓN ─────────────────────────────────────────────────────────────────
  {id:"r18", boss:"Drakon, el Dragón Ancestral",   icon:"🐉", rarity:"legendaria",
   desc:"El dragón más antiguo del reino. Su aliento quema almas.",
   challenge:"200 Flexiones", reps:200, exercise:"Flexiones",
   xp:1000, coins:500, time:86400},
  {id:"r19", boss:"Wyvern Carmesí, el Terror Alado",        icon:"🐉", rarity:"épica",
   desc:"Alas de fuego, colmillos de acero. Respira y aguanta.",
   challenge:"100 Flexiones + 100 Sentadillas", reps:200, exercise:"Flexiones + Sentadillas",
   xp:550, coins:225, time:86400},

  // ── DIOS ───────────────────────────────────────────────────────────────────
  {id:"r20", boss:"Ares, el Dios de la Guerra Eterna",icon:"⚔️", rarity:"legendaria",
   desc:"El dios de la guerra en persona. La batalla más épica de tu vida.",
   challenge:"50 Burpees + 100 Flexiones + 150 Sentadillas + 200 Abdominales", reps:500, exercise:"The Gauntlet",
   xp:1500, coins:750, time:86400},
];

const RAID_RARITY_COLOR = {normal:"#60A5FA", épica:"#A78BFA", legendaria:"#F59E0B"};
const RAID_TRIGGER_CHANCE = 0.12; // 20% on dungeon complete or app open

const ACHIEVEMENTS = [
  // ── PRIMEROS PASOS ───────────────────────────────────────────────────────────
  {id:"first_exercise", icon:"⚔️", name:"Primera Sangre",     desc:"Completa tu primer ejercicio",          xp:50,   check:s=>s.totalDone>=1},
  {id:"first_day",      icon:"🗡️", name:"Superviviente",      desc:"Completa tu primer día entero",         xp:150,  check:s=>s.daysComplete>=1},
  {id:"first_record",   icon:"📈", name:"Rompe Límites",      desc:"Supera tu primer récord de peso",       xp:200,  check:s=>s.prCount>=1},
  {id:"first_log",      icon:"📝", name:"Escribiendo Historia",desc:"Registra tu primer peso",               xp:75,   check:s=>s.totalWeightLogs>=1},

  // ── VOLUMEN DE EJERCICIOS ────────────────────────────────────────────────────
  {id:"ten_exercises",  icon:"🛡️", name:"Veterano",           desc:"Completa 10 ejercicios",                xp:100,  check:s=>s.totalDone>=10},
  {id:"thirty_done",    icon:"🔥", name:"En Llamas",          desc:"Completa 30 ejercicios",                xp:300,  check:s=>s.totalDone>=30},
  {id:"hundred_done",   icon:"💯", name:"Centurión",          desc:"Completa 100 ejercicios",               xp:500,  check:s=>s.totalDone>=100},
  {id:"twofifty_done",  icon:"🌋", name:"Imparable",          desc:"Completa 250 ejercicios",               xp:800,  check:s=>s.totalDone>=250},
  {id:"fivehund_done",  icon:"🌠", name:"Leyenda del Hierro", desc:"Completa 500 ejercicios",               xp:1500, check:s=>s.totalDone>=500},

  // ── DÍAS COMPLETOS ───────────────────────────────────────────────────────────
  {id:"five_days",      icon:"📅", name:"Consistente",        desc:"Completa 5 días de entreno",            xp:250,  check:s=>s.daysComplete>=5},
  {id:"ten_days",       icon:"🗓️", name:"Hábito Forjado",     desc:"Completa 10 días de entreno",           xp:400,  check:s=>s.daysComplete>=10},
  {id:"twentyfive_days",icon:"🔒", name:"Disciplina de Acero",desc:"Completa 25 días de entreno",           xp:700,  check:s=>s.daysComplete>=25},

  // ── RÉCORDS PERSONALES ───────────────────────────────────────────────────────
  {id:"five_records",   icon:"🏅", name:"Coleccionista de PRs",desc:"Supera 5 récords personales",          xp:350,  check:s=>s.prCount>=5},
  {id:"ten_records",    icon:"🥇", name:"Máquina de Progreso", desc:"Supera 10 récords personales",         xp:600,  check:s=>s.prCount>=10},
  {id:"twentyfive_rec", icon:"💎", name:"Élite",               desc:"Supera 25 récords personales",         xp:1000, check:s=>s.prCount>=25},

  // ── REGISTROS DE PESO ────────────────────────────────────────────────────────
  {id:"ten_weights",    icon:"📊", name:"Analista",            desc:"Registra 10 pesos",                    xp:100,  check:s=>s.totalWeightLogs>=10},
  {id:"fifty_weights",  icon:"💪", name:"Iron Will",           desc:"Registra 50 pesos",                    xp:300,  check:s=>s.totalWeightLogs>=50},
  {id:"hundred_weights",icon:"📉", name:"Tracker Élite",       desc:"Registra 100 pesos",                   xp:500,  check:s=>s.totalWeightLogs>=100},

  // ── FASES DEL PROGRAMA ───────────────────────────────────────────────────────
  {id:"phase1_done",    icon:"🏰", name:"Dungeon I Conquistado", desc:"Completa la Fase 1 al completo",     xp:500,  check:s=>s.phase1Complete},
  {id:"phase2_done",    icon:"⚡", name:"Dungeon II Conquistado",desc:"Completa la Fase 2 al completo",     xp:700,  check:s=>s.phase2Complete},
  {id:"phase3_done",    icon:"👑", name:"Mítico RankUp",         desc:"Completa el programa de 12 semanas", xp:1500, check:s=>s.phase3Complete},

  // ── RUTINAS ──────────────────────────────────────────────────────────────────
  {id:"custom_routine", icon:"🗺️", name:"Explorador",           desc:"Completa tu primera rutina asignada", xp:200,  check:s=>s.customRoutines>=1},
  {id:"three_routines", icon:"⚙️", name:"Polivalente",           desc:"Completa 3 rutinas asignadas",        xp:400,  check:s=>s.customRoutines>=3},

  // ── MONEDAS GANADAS ──────────────────────────────────────────────────────────
  {id:"coins_500",      icon:"🪙", name:"Primer Tesoro",         desc:"Acumula 500 monedas en total",        xp:150,  check:s=>s.totalCoinsEarned>=500},
  {id:"coins_2000",     icon:"💰", name:"Adinerado",             desc:"Acumula 2.000 monedas en total",      xp:300,  check:s=>s.totalCoinsEarned>=2000},
  {id:"coins_5000",     icon:"🏦", name:"Magnate del Gym",       desc:"Acumula 5.000 monedas en total",      xp:600,  check:s=>s.totalCoinsEarned>=5000},
  // ── RAIDS ─────────────────────────────────────────────────────────────────
  {id:"first_raid",     icon:"⚔️", name:"Primer Encuentro",      desc:"Completa tu primera Raid",            xp:300,  check:s=>s.raidsComplete>=1},
  {id:"raids_5",        icon:"🗡️", name:"Cazador de Sombras",    desc:"Completa 5 Raids",                    xp:500,  check:s=>s.raidsComplete>=5},
  {id:"raids_10",       icon:"💀", name:"Exterminador",          desc:"Completa 10 Raids",                   xp:800,  check:s=>s.raidsComplete>=10},
  {id:"raids_25",       icon:"👑", name:"Leyenda de las Raids",  desc:"Completa 25 Raids",                   xp:1500, check:s=>s.raidsComplete>=25},
  {id:"raid_legendary", icon:"🐉", name:"Mata Dragones",         desc:"Completa una Raid legendaria",        xp:1000, check:s=>s.legendaryRaids>=1},
];

const REWARDS = [
  {id:"snack_1",cat:"🍬 Caprichos",icon:"🍫",name:"Chocolatina",         desc:"Una chocolatina de tu elección.",           cost:200},
  {id:"snack_2",cat:"🍬 Caprichos",icon:"🍕",name:"Porción de pizza",    desc:"1 porción sin culpa. La ganaste.",          cost:400},
  {id:"snack_3",cat:"🍬 Caprichos",icon:"🍦",name:"Helado mediano",      desc:"El sabor que quieras. Sin restricciones.",  cost:300},
  {id:"snack_4",cat:"🍬 Caprichos",icon:"🍔",name:"Hamburguesa completa",desc:"Burger con todo. Día libre de macros.",     cost:750},
  {id:"snack_5",cat:"🍬 Caprichos",icon:"🥤",name:"Refresco grande",     desc:"El refresco que tenías ganas.",             cost:150},
  {id:"snack_6",cat:"🍬 Caprichos",icon:"🧁",name:"Muffin o cupcake",    desc:"Uno grande. Sin mirar las calorías.",       cost:225},
  {id:"snack_7",cat:"🍬 Caprichos",icon:"🍟",name:"Patatas fritas L",    desc:"Talla grande. Las mejores post-entreno.",   cost:250},
  {id:"snack_8",cat:"🍬 Caprichos",icon:"🎂",name:"Tarde libre de dieta",desc:"Una tarde entera sin contar nada.",         cost:1000},
  {id:"rest_1", cat:"😴 Descanso", icon:"🛌",name:"Siesta sin culpa",    desc:"30–45 min. El cuerpo lo pide.",            cost:150},
  {id:"rest_2", cat:"😴 Descanso", icon:"📺",name:"Serie sin límite",    desc:"Una tarde entera de sofá y serie.",         cost:400},
  {id:"rest_3", cat:"😴 Descanso", icon:"🛁",name:"Baño de recuperación",desc:"Baño caliente largo con sales.",            cost:275},
  {id:"rest_4", cat:"😴 Descanso", icon:"🎮",name:"Sesión de gaming",    desc:"2 horas sin interrupciones.",               cost:300},
  {id:"rest_5", cat:"😴 Descanso", icon:"📚",name:"Tarde de lectura",    desc:"Sin obligaciones. Solo tú y tu libro.",     cost:200},
  {id:"epic_1", cat:"🏆 Épicas",   icon:"💆",name:"Masaje deportivo",    desc:"1 hora de masaje. Tu cuerpo lo pidió.",    cost:1500},
  {id:"epic_2", cat:"🏆 Épicas",   icon:"👟",name:"Ropa deportiva nueva",desc:"Una prenda nueva para el gym.",             cost:2000},
  {id:"epic_3", cat:"🏆 Épicas",   icon:"🍽️",name:"Cena especial",       desc:"Tu restaurante favorito. Sin límite.",      cost:2500},
  {id:"epic_4", cat:"🏆 Épicas",   icon:"🎯",name:"Día de aventura",     desc:"Escala, senderismo, surf…",                cost:3000},
  {id:"epic_5", cat:"🏆 Épicas",   icon:"👑",name:"Fin de semana libre", desc:"72h sin plan. Recarga total.",              cost:5000},
];

// ─── PHASES DATA ─────────────────────────────────────────────────────────────
const PHASES = [
{id:1,name:"FASE 1",subtitle:"Activación",weeks:"Semanas 1–4",color:"#E8C547",glow:"#E8C54755",
 goal:"Crear el hábito, activar el metabolismo",dungeonName:"Dungeon del Despertar",
 mantra:"No entrenas para hoy. Entrenas para el que serás en el futuro.",
 nutrition:{calories:"Déficit ~300 kcal",protein:"1.8–2g/kg",
  meals:[{time:"8:00",name:"Desayuno",ex:"2 huevos+3 claras · 2 tostadas · 1 fruta"},{time:"13:00",name:"Comida",ex:"150g pollo/merluza · Arroz o patata · Ensalada"},{time:"17:00",name:"Pre-entreno",ex:"Yogur griego · 1 plátano · Frutos secos"},{time:"20:30",name:"Cena",ex:"150g salmón o pechuga · Verduras · 1 naranja"}],
  tips:["Bebe 2.5–3L de agua al día","No saltes comidas. Hambre: fruta o yogur","Fin de semana: 1 comida libre, no día libre"]},
 training:[
  {day:"S1·Lunes — Full Body A",week:1,exercises:[{name:"Sentadilla con Barra",sets:"4x10",rest:"90s",xp:40,boss:false,notes:"Peso cómodo."},{name:"Press Banca Plano",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Remo con Barra",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Prensa 45°",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Curl con Barra",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Plancha",sets:"3x30s",rest:"45s",xp:25,boss:false}]},
  {day:"S1·Miércoles — Full Body B",week:1,exercises:[{name:"Peso Muerto Rumano",sets:"4x10",rest:"90s",xp:40,boss:false,notes:"Espalda neutra"},{name:"Press Militar Mancuernas",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Jalones al Pecho",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Zancadas Caminando",sets:"3x12/pierna",rest:"60s",xp:35,boss:false},{name:"Extensión Polea Alta",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Crunch Abdominal",sets:"3x15",rest:"45s",xp:25,boss:false}]},
  {day:"S1·Viernes — Full Body C",week:1,exercises:[{name:"Sentadilla Goblet",sets:"3x15",rest:"45s",xp:35,boss:false,notes:"Circuito"},{name:"Flexiones",sets:"3x15",rest:"45s",xp:30,boss:false},{name:"Remo con Mancuerna",sets:"3x15/lado",rest:"45s",xp:35,boss:false},{name:"Hip Thrust con Barra",sets:"3x15",rest:"45s",xp:35,boss:false},{name:"Face Pull",sets:"3x15",rest:"45s",xp:30,boss:false},{name:"Cardio Zona 2",sets:"20min",rest:"—",xp:60,boss:true,notes:"¡BOSS!"}]},
  {day:"S2·Lunes — Full Body A",week:2,exercises:[{name:"Sentadilla con Barra",sets:"4x10",rest:"90s",xp:40,boss:false,notes:"+2.5kg"},{name:"Press Banca Plano",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Remo con Barra",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Prensa 45°",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Curl con Barra",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Plancha",sets:"3x35s",rest:"45s",xp:25,boss:false,notes:"+5s"}]},
  {day:"S2·Miércoles — Full Body B",week:2,exercises:[{name:"Peso Muerto Rumano",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Press Militar Mancuernas",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Jalones al Pecho",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Zancadas Caminando",sets:"3x12/pierna",rest:"60s",xp:35,boss:false},{name:"Extensión Polea Alta",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Crunch Abdominal",sets:"3x15",rest:"45s",xp:25,boss:false}]},
  {day:"S2·Viernes — Full Body C",week:2,exercises:[{name:"Sentadilla Goblet",sets:"3x15",rest:"45s",xp:35,boss:false},{name:"Flexiones",sets:"3x15",rest:"45s",xp:30,boss:false},{name:"Remo con Mancuerna",sets:"3x15/lado",rest:"45s",xp:35,boss:false},{name:"Hip Thrust con Barra",sets:"3x15",rest:"45s",xp:35,boss:false},{name:"Face Pull",sets:"3x15",rest:"45s",xp:30,boss:false},{name:"Cardio Zona 2",sets:"22min",rest:"—",xp:60,boss:true,notes:"¡BOSS!+2min"}]},
  {day:"S3·Lunes — Full Body A",week:3,exercises:[{name:"Sentadilla con Barra",sets:"4x10",rest:"90s",xp:40,boss:false,notes:"+2.5kg vs S2"},{name:"Press Banca Plano",sets:"4x10",rest:"90s",xp:40,boss:false,notes:"+2.5kg"},{name:"Remo con Barra",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Prensa 45°",sets:"4x12",rest:"60s",xp:35,boss:false,notes:"1 serie más"},{name:"Curl con Barra",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Plancha",sets:"3x40s",rest:"45s",xp:28,boss:false,notes:"+5s"}]},
  {day:"S3·Miércoles — Full Body B",week:3,exercises:[{name:"Peso Muerto Rumano",sets:"4x10",rest:"90s",xp:40,boss:false,notes:"Sube si técnica sólida"},{name:"Press Militar Mancuernas",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Jalones al Pecho",sets:"4x10",rest:"90s",xp:40,boss:false},{name:"Zancadas Caminando",sets:"3x14/pierna",rest:"60s",xp:35,boss:false,notes:"+2 reps"},{name:"Extensión Polea Alta",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Crunch Abdominal",sets:"3x18",rest:"45s",xp:28,boss:false}]},
  {day:"S3·Viernes — Full Body C",week:3,exercises:[{name:"Sentadilla Goblet",sets:"4x15",rest:"45s",xp:38,boss:false,notes:"Circuito+1serie"},{name:"Flexiones",sets:"4x15",rest:"45s",xp:33,boss:false},{name:"Remo con Mancuerna",sets:"3x15/lado",rest:"45s",xp:35,boss:false},{name:"Hip Thrust con Barra",sets:"4x15",rest:"45s",xp:38,boss:false},{name:"Face Pull",sets:"3x15",rest:"45s",xp:30,boss:false},{name:"Cardio Zona 2",sets:"25min",rest:"—",xp:65,boss:true,notes:"¡BOSS!+5min"}]},
  {day:"S4·Lunes — Descarga",week:4,exercises:[{name:"Sentadilla con Barra",sets:"3x10",rest:"90s",xp:38,boss:false,notes:"Descarga:80%"},{name:"Press Banca Plano",sets:"3x10",rest:"90s",xp:38,boss:false},{name:"Remo con Barra",sets:"3x10",rest:"90s",xp:38,boss:false},{name:"Prensa 45°",sets:"3x10",rest:"60s",xp:28,boss:false},{name:"Curl con Barra",sets:"3x10",rest:"60s",xp:28,boss:false},{name:"Plancha",sets:"3x30s",rest:"45s",xp:22,boss:false}]},
  {day:"S4·Miércoles — Descarga",week:4,exercises:[{name:"Peso Muerto Rumano",sets:"3x10",rest:"90s",xp:38,boss:false,notes:"Técnica perfecta"},{name:"Press Militar Mancuernas",sets:"3x10",rest:"90s",xp:38,boss:false},{name:"Jalones al Pecho",sets:"3x10",rest:"90s",xp:38,boss:false},{name:"Zancadas Caminando",sets:"3x10/pierna",rest:"60s",xp:30,boss:false},{name:"Extensión Polea Alta",sets:"3x10",rest:"60s",xp:26,boss:false},{name:"Crunch Abdominal",sets:"3x12",rest:"45s",xp:22,boss:false}]},
  {day:"S4·Viernes — TEST FASE 1",week:4,exercises:[{name:"Sentadilla con Barra",sets:"1x10",rest:"—",xp:30,boss:false,notes:"Test: anota tu mejor peso"},{name:"Press Banca Plano",sets:"1x10",rest:"—",xp:30,boss:false,notes:"Test"},{name:"Peso Muerto Rumano",sets:"1x10",rest:"—",xp:30,boss:false,notes:"Test"},{name:"Flexiones",sets:"1xMáx",rest:"—",xp:30,boss:false,notes:"¿Cuántas?"},{name:"Plancha",sets:"1xMáx",rest:"—",xp:30,boss:false,notes:"¿Cuánto?"},{name:"Cardio Zona 2",sets:"30min",rest:"—",xp:70,boss:true,notes:"¡BOSS FINAL FASE 1!"}]}
 ]},
{id:2,name:"FASE 2",subtitle:"Construcción",weeks:"Semanas 5–8",color:"#F4714A",glow:"#F4714A55",
 goal:"Aumentar intensidad, perder grasa visible",dungeonName:"Dungeon de la Forja",
 mantra:"La disciplina es elegir entre lo que quieres ahora y lo que quieres más.",
 nutrition:{calories:"Déficit 400 kcal",protein:"2–2.2g/kg",
  meals:[{time:"8:00",name:"Desayuno",ex:"Tortilla 3 huevos · 2 tostadas · Café"},{time:"13:00",name:"Comida",ex:"200g carne/pescado · Pasta integral · Ensalada"},{time:"17:30",name:"Pre-entreno",ex:"Batido proteína + plátano"},{time:"21:00",name:"Cena",ex:"150g merluza · Verduras · 1 huevo extra"}],
  tips:["Aumenta proteína si notas hambre","Meal prep el día anterior","Reduce hidratos en cena días descanso"]},
 training:[
  {day:"S5·Lunes — Piernas",week:5,exercises:[{name:"Sentadilla con Barra",sets:"5x8",rest:"2min",xp:55,boss:false,notes:"Sube peso vs S4"},{name:"Prensa 45°",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Hip Thrust con Barra",sets:"4x12",rest:"90s",xp:50,boss:false},{name:"Curl Femoral Tumbado",sets:"3x12",rest:"60s",xp:35,boss:false},{name:"Elevación de Talones",sets:"4x15",rest:"45s",xp:30,boss:false},{name:"HIIT en Cinta",sets:"15min",rest:"—",xp:80,boss:true,notes:"¡BOSS!30s sprint/60s×10"}]},
  {day:"S5·Miércoles — Empuje",week:5,exercises:[{name:"Press Banca Plano",sets:"5x8",rest:"2min",xp:55,boss:false},{name:"Press Banca Inclinado",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Press Militar Barra",sets:"4x8",rest:"2min",xp:55,boss:false},{name:"Elevaciones Laterales",sets:"3x15",rest:"60s",xp:35,boss:false},{name:"Fondos en Paralelas",sets:"3x10",rest:"60s",xp:40,boss:false},{name:"Extensión Polea Alta",sets:"3x12",rest:"60s",xp:35,boss:false}]},
  {day:"S5·Viernes — Tirón",week:5,exercises:[{name:"Peso Muerto",sets:"4x6",rest:"2.5min",xp:70,boss:true,notes:"¡BOSS! Movimiento rey"},{name:"Dominadas",sets:"4x8",rest:"2min",xp:55,boss:false},{name:"Remo con Barra",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Curl con Barra",sets:"3x10",rest:"60s",xp:35,boss:false},{name:"Curl Martillo",sets:"3x12",rest:"60s",xp:32,boss:false},{name:"Rueda Abdominal",sets:"3x10",rest:"60s",xp:40,boss:false}]},
  {day:"S6·Lunes — Piernas",week:6,exercises:[{name:"Sentadilla con Barra",sets:"5x8",rest:"2min",xp:55,boss:false,notes:"+2.5kg vs S5"},{name:"Prensa 45°",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Hip Thrust con Barra",sets:"4x12",rest:"90s",xp:50,boss:false},{name:"Curl Femoral Tumbado",sets:"3x12",rest:"60s",xp:35,boss:false},{name:"Elevación de Talones",sets:"4x15",rest:"45s",xp:30,boss:false},{name:"HIIT en Cinta",sets:"16min",rest:"—",xp:82,boss:true,notes:"¡BOSS!+1intervalo"}]},
  {day:"S6·Miércoles — Empuje",week:6,exercises:[{name:"Press Banca Plano",sets:"5x8",rest:"2min",xp:55,boss:false,notes:"+2.5kg"},{name:"Press Banca Inclinado",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Press Militar Barra",sets:"4x8",rest:"2min",xp:55,boss:false},{name:"Elevaciones Laterales",sets:"4x15",rest:"60s",xp:38,boss:false,notes:"1serie más"},{name:"Fondos en Paralelas",sets:"3x12",rest:"60s",xp:42,boss:false},{name:"Extensión Polea Alta",sets:"3x12",rest:"60s",xp:35,boss:false}]},
  {day:"S6·Viernes — Tirón",week:6,exercises:[{name:"Peso Muerto",sets:"4x6",rest:"2.5min",xp:70,boss:true,notes:"¡BOSS!+5kg vs S5"},{name:"Dominadas",sets:"4x8",rest:"2min",xp:55,boss:false},{name:"Remo con Barra",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Curl con Barra",sets:"3x10",rest:"60s",xp:35,boss:false},{name:"Curl Martillo",sets:"3x12",rest:"60s",xp:32,boss:false},{name:"Rueda Abdominal",sets:"3x12",rest:"60s",xp:42,boss:false}]},
  {day:"S7·Lunes — Piernas",week:7,exercises:[{name:"Sentadilla con Barra",sets:"5x8",rest:"2min",xp:55,boss:false,notes:"Máximo hasta ahora"},{name:"Prensa 45°",sets:"5x10",rest:"90s",xp:48,boss:false,notes:"1serie más"},{name:"Hip Thrust con Barra",sets:"5x12",rest:"90s",xp:52,boss:false},{name:"Curl Femoral Tumbado",sets:"4x12",rest:"60s",xp:38,boss:false},{name:"Elevación de Talones",sets:"4x15",rest:"45s",xp:30,boss:false},{name:"Bici Estática HIIT",sets:"18min",rest:"—",xp:85,boss:true,notes:"¡BOSS!Tabata 20/10×9"}]},
  {day:"S7·Miércoles — Empuje",week:7,exercises:[{name:"Press Banca Plano",sets:"5x6",rest:"2min",xp:60,boss:false,notes:"Menos reps, más peso"},{name:"Press Banca Inclinado",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Press Militar Barra",sets:"4x6",rest:"2min",xp:58,boss:false},{name:"Elevaciones Laterales",sets:"4x15",rest:"60s",xp:38,boss:false},{name:"Fondos en Paralelas",sets:"4x10",rest:"60s",xp:45,boss:false,notes:"1serie más"},{name:"Extensión Polea Alta",sets:"4x12",rest:"60s",xp:38,boss:false}]},
  {day:"S7·Viernes — Tirón",week:7,exercises:[{name:"Peso Muerto",sets:"5x5",rest:"3min",xp:80,boss:true,notes:"¡BOSS!Máximo Fase 2"},{name:"Dominadas",sets:"5x8",rest:"2min",xp:55,boss:false,notes:"1serie más"},{name:"Remo con Barra",sets:"4x10",rest:"90s",xp:45,boss:false},{name:"Curl con Barra",sets:"4x10",rest:"60s",xp:38,boss:false},{name:"Curl Martillo",sets:"3x12",rest:"60s",xp:32,boss:false},{name:"Rueda Abdominal",sets:"4x10",rest:"60s",xp:44,boss:false}]},
  {day:"S8·Lunes — Descarga",week:8,exercises:[{name:"Sentadilla con Barra",sets:"3x8",rest:"2min",xp:45,boss:false,notes:"Descarga:75%"},{name:"Prensa 45°",sets:"3x10",rest:"90s",xp:38,boss:false},{name:"Hip Thrust con Barra",sets:"3x12",rest:"90s",xp:42,boss:false},{name:"Curl Femoral Tumbado",sets:"3x10",rest:"60s",xp:30,boss:false},{name:"HIIT en Cinta",sets:"10min",rest:"—",xp:60,boss:true,notes:"¡BOSS!baja intensidad"}]},
  {day:"S8·Miércoles — Descarga",week:8,exercises:[{name:"Press Banca Plano",sets:"3x8",rest:"2min",xp:45,boss:false,notes:"Descarga:75%"},{name:"Press Banca Inclinado",sets:"3x10",rest:"90s",xp:38,boss:false},{name:"Press Militar Barra",sets:"3x8",rest:"2min",xp:45,boss:false},{name:"Elevaciones Laterales",sets:"3x12",rest:"60s",xp:30,boss:false},{name:"Extensión Polea Alta",sets:"3x10",rest:"60s",xp:30,boss:false}]},
  {day:"S8·Viernes — TEST FASE 2",week:8,exercises:[{name:"Sentadilla con Barra",sets:"1x5",rest:"—",xp:50,boss:false,notes:"Test 5RM"},{name:"Press Banca Plano",sets:"1x5",rest:"—",xp:50,boss:false,notes:"Test 5RM"},{name:"Peso Muerto",sets:"1x5",rest:"—",xp:60,boss:true,notes:"¡BOSS!Test 5RM"},{name:"Dominadas",sets:"1xMáx",rest:"—",xp:40,boss:false,notes:"Test máx reps"},{name:"HIIT en Cinta",sets:"12min",rest:"—",xp:65,boss:true,notes:"¡BOSS!Sprint final"}]}
 ]},
{id:3,name:"FASE 3",subtitle:"Transformación",weeks:"Semanas 9–12",color:"#E84A5F",glow:"#E84A5F55",
 goal:"Definición máxima, rendimiento pico",dungeonName:"Dungeon Abismal",
 mantra:"No pares cuando estés cansado. Para cuando hayas terminado.",
 nutrition:{calories:"Déficit 500 kcal · Carb cycling",protein:"2.2–2.4g/kg",
  meals:[{time:"8:00",name:"Desayuno proteico",ex:"4 claras+2 huevos · 1 tostada · 1 naranja"},{time:"13:00",name:"Comida fuerte",ex:"200g pechuga/atún · Arroz (días entreno) · Verduras"},{time:"17:00",name:"Pre-entreno",ex:"Batido 25g proteína + café"},{time:"21:00",name:"Cena ligera",ex:"2 huevos+100g atún · Verduras · Sin hidratos días descanso"}],
  tips:["Días descanso: reduce hidratos 40%","Añade recarga si notas bajón","Elimina alcohol estas 4 semanas"]},
 training:[
  {day:"S9·Lunes — Piernas Alta",week:9,exercises:[{name:"Sentadilla Búlgara",sets:"5x6",rest:"2.5min",xp:75,boss:true,notes:"¡BOSS!Máxima intensidad"},{name:"Peso Muerto Rumano",sets:"4x8",rest:"2min",xp:55,boss:false},{name:"Hip Thrust Unilateral",sets:"4x10/lado",rest:"90s",xp:55,boss:false},{name:"Hack Squat",sets:"3x12",rest:"90s",xp:45,boss:false},{name:"Remo Ergómetro",sets:"20min",rest:"—",xp:90,boss:true,notes:"¡BOSS!"}]},
  {day:"S9·Miércoles — Empuje Avanzado",week:9,exercises:[{name:"Press Banca Plano",sets:"5x5",rest:"3min",xp:80,boss:true,notes:"¡BOSS!Supera test S8"},{name:"Aperturas Inclinado",sets:"4x12",rest:"60s",xp:35,boss:false},{name:"Press Arnold",sets:"4x10",rest:"90s",xp:48,boss:false},{name:"Face Pull",sets:"3x15",rest:"60s",xp:30,boss:false,notes:"Salud hombros"},{name:"Press Cerrado",sets:"3x10",rest:"90s",xp:45,boss:false}]},
  {day:"S9·Viernes — Tirón Pesado",week:9,exercises:[{name:"Peso Muerto",sets:"4x5",rest:"3min",xp:90,boss:true,notes:"¡BOSS!Supera 5RM S8"},{name:"Dominadas Lastradas",sets:"4x8",rest:"2min",xp:65,boss:false},{name:"Remo en T",sets:"4x10",rest:"90s",xp:50,boss:false},{name:"Curl Inclinado",sets:"3x10",rest:"60s",xp:35,boss:false},{name:"Rueda Abdominal",sets:"4x10",rest:"60s",xp:44,boss:false}]},
  {day:"S10·Lunes — Piernas",week:10,exercises:[{name:"Sentadilla Búlgara",sets:"5x6",rest:"2.5min",xp:75,boss:true,notes:"¡BOSS!+2.5kg vs S9"},{name:"Peso Muerto Rumano",sets:"4x8",rest:"2min",xp:55,boss:false},{name:"Hip Thrust Unilateral",sets:"4x10/lado",rest:"90s",xp:55,boss:false},{name:"Hack Squat",sets:"4x12",rest:"90s",xp:48,boss:false,notes:"1serie más"},{name:"Remo Ergómetro",sets:"20min",rest:"—",xp:90,boss:true,notes:"¡BOSS!Aumenta velocidad"}]},
  {day:"S10·Miércoles — Empuje",week:10,exercises:[{name:"Press Banca Plano",sets:"5x5",rest:"3min",xp:80,boss:true,notes:"¡BOSS!+2.5kg vs S9"},{name:"Aperturas Inclinado",sets:"4x12",rest:"60s",xp:35,boss:false},{name:"Press Arnold",sets:"4x10",rest:"90s",xp:48,boss:false,notes:"Sube mancuernas"},{name:"Face Pull",sets:"4x15",rest:"60s",xp:33,boss:false,notes:"1serie más"},{name:"Press Cerrado",sets:"4x10",rest:"90s",xp:48,boss:false,notes:"1ronda más"}]},
  {day:"S10·Viernes — Tirón",week:10,exercises:[{name:"Peso Muerto",sets:"4x5",rest:"3min",xp:90,boss:true,notes:"¡BOSS!+5kg vs S9"},{name:"Dominadas Lastradas",sets:"4x8",rest:"2min",xp:65,boss:false,notes:"+2.5kg lastrado"},{name:"Remo en T",sets:"4x10",rest:"90s",xp:50,boss:false},{name:"Curl Inclinado",sets:"4x10",rest:"60s",xp:38,boss:false,notes:"1serie más"},{name:"Rueda Abdominal",sets:"4x12",rest:"60s",xp:47,boss:false}]},
  {day:"S11·Lunes — Pico Piernas",week:11,exercises:[{name:"Front Squat",sets:"6x5",rest:"3min",xp:85,boss:true,notes:"¡BOSS!Pico de carga"},{name:"Peso Muerto Rumano",sets:"5x6",rest:"2min",xp:62,boss:false},{name:"Hip Thrust Unilateral",sets:"5x8/lado",rest:"90s",xp:60,boss:false},{name:"Hack Squat",sets:"4x10",rest:"90s",xp:50,boss:false},{name:"Burpees",sets:"22min",rest:"—",xp:95,boss:true,notes:"¡BOSS!Máxima intensidad del plan"}]},
  {day:"S11·Miércoles — Pico Empuje",week:11,exercises:[{name:"Press Banca Plano",sets:"6x4",rest:"3min",xp:90,boss:true,notes:"¡BOSS!Semana pico"},{name:"Aperturas Inclinado",sets:"4x10",rest:"60s",xp:35,boss:false},{name:"Press Arnold",sets:"5x8",rest:"90s",xp:52,boss:false},{name:"Face Pull",sets:"4x15",rest:"60s",xp:33,boss:false},{name:"Press Cerrado",sets:"4x10",rest:"90s",xp:48,boss:false}]},
  {day:"S11·Viernes — Pico Tirón",week:11,exercises:[{name:"Peso Muerto",sets:"5x3",rest:"3.5min",xp:100,boss:true,notes:"¡BOSS!Máximo del ciclo"},{name:"Dominadas Lastradas",sets:"5x6",rest:"2.5min",xp:65,boss:false},{name:"Remo en T",sets:"5x8",rest:"90s",xp:55,boss:false},{name:"Curl Inclinado",sets:"4x8",rest:"60s",xp:40,boss:false},{name:"Rueda Abdominal",sets:"4x12",rest:"60s",xp:47,boss:false}]},
  {day:"S12·Lunes — Descarga Final",week:12,exercises:[{name:"Sentadilla con Barra",sets:"3x6",rest:"2min",xp:40,boss:false,notes:"60% peso máximo"},{name:"Press Banca Plano",sets:"3x6",rest:"2min",xp:40,boss:false,notes:"60%"},{name:"Peso Muerto Rumano",sets:"3x6",rest:"2min",xp:40,boss:false},{name:"Cardio Zona 2",sets:"15min",rest:"—",xp:50,boss:false,notes:"Zona 2, tranquilo"}]},
  {day:"S12·Miércoles — Activación",week:12,exercises:[{name:"Sentadilla con Barra",sets:"2x5",rest:"2min",xp:35,boss:false,notes:"70%, explosivo"},{name:"Press Banca Plano",sets:"2x5",rest:"2min",xp:35,boss:false,notes:"70%"},{name:"Peso Muerto",sets:"2x3",rest:"2.5min",xp:40,boss:false,notes:"70%"},{name:"Dominadas",sets:"3x5",rest:"90s",xp:35,boss:false},{name:"Plancha",sets:"2x30s",rest:"30s",xp:20,boss:false}]},
  {day:"S12·Viernes — TEST FINAL FITNESS",week:12,exercises:[{name:"Sentadilla con Barra",sets:"1x3RM",rest:"5min",xp:100,boss:true,notes:"¡BOSS FINAL!Tu 3RM"},{name:"Press Banca Plano",sets:"1x3RM",rest:"5min",xp:100,boss:true,notes:"¡BOSS FINAL!Tu 3RM"},{name:"Peso Muerto",sets:"1x3RM",rest:"5min",xp:100,boss:true,notes:"¡BOSS FINAL!90 días"},{name:"Dominadas Lastradas",sets:"1xMáx",rest:"3min",xp:80,boss:true,notes:"¡BOSS!Máx reps lastradas"},{name:"Burpees",sets:"3rondas",rest:"60s",xp:80,boss:true,notes:"¡BOSS!×10·KB×15·Plancha45s"}]}
 ]}
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const exKey=(phId,di,ei)=>`p${phId}_d${di}_e${ei}`;
const getRank=lvl=>RANKS.find(r=>lvl>=r.minLevel&&lvl<=r.maxLevel)||RANKS[RANKS.length-1];
const getLevel=xp=>Math.floor(xp/XP_PER_LEVEL)+1;
const getXpInLevel=xp=>xp%XP_PER_LEVEL;
const getMR=xp=>[...MUSCLE_RANKS].reverse().find(r=>xp>=r.min)||MUSCLE_RANKS[0];
const getNextMR=xp=>{const i=MUSCLE_RANKS.findIndex(r=>r.min>xp);return i>=0?MUSCLE_RANKS[i]:null;};
const hashPw=str=>btoa(unescape(encodeURIComponent(str+"_rankup_salt_2024")));

// ─── ADMIN CREDENTIALS (cambia estas en producción) ──────────────────────────
const ADMIN_EMAIL="admin@rankup.fit";
const ADMIN_PASSWORD=hashPw("RankUp2024!");

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────
const getSession=()=>{try{return JSON.parse(localStorage.getItem("rku_session")||"null");}catch{return null;}};
const setSession=email=>localStorage.setItem("rku_session",JSON.stringify({email,ts:Date.now()}));
const clearSession=()=>localStorage.removeItem("rku_session");
const defaultData=()=>({totalXp:0,coins:0,checked:{},weights:{},personalRecords:{},earnedAchs:[],redeemedRewards:[],dungeonCoins:{},customRoutines:[],playerClass:null,assignedDiets:[],assignedProgram:null});

// ─── GLOBAL CSS ───────────────────────────────────────────────────────────────
const CSS=`
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&family=Cinzel:wght@700;900&display=swap');
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{margin:0;background:#07070F;overscroll-behavior:none}
  ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#2A2A44;border-radius:4px}
  input::-webkit-inner-spin-button{-webkit-appearance:none}
  @keyframes xpFloat{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-65px) scale(1.4)}}
  @keyframes lvlPop{0%{opacity:0;transform:scale(.4)}70%{transform:scale(1.07)}100%{opacity:1;transform:scale(1)}}
  @keyframes toastR{0%{opacity:0;transform:translateX(100px)}100%{opacity:1;transform:translateX(0)}}
  @keyframes toastL{0%{opacity:0;transform:translateX(-100px)}100%{opacity:1;transform:translateX(0)}}
  @keyframes coinPop{0%{opacity:0;transform:scale(.5)}70%{transform:scale(1.1)}100%{opacity:1;transform:scale(1)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
  @keyframes bossGlow{0%,100%{box-shadow:0 0 8px #E84A5F44}50%{box-shadow:0 0 24px #E84A5F99}}
  @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
  .fade-up{animation:fadeUp .3s ease}
  .shake{animation:shake .4s ease}
`;

// ─── HELM ICON ───────────────────────────────────────────────────────────────
const LOGO_B64 = "data:image/png;base64,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";
// CazadoresFitness v2.1 — RankUp Fitness App
function HelmIcon({size=72,glow="#A78BFA"}){
  return(
    <img src={LOGO_B64} width={size} height={Math.round(size*1.08)}
      style={{filter:`drop-shadow(0 0 12px ${glow}) drop-shadow(0 0 24px ${glow}88)`,display:"block"}}
      alt="RankUp"/>
  );
}

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function Particle({x,y,text,color,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,1300);return()=>clearTimeout(t);},[]);
  return <div style={{position:"fixed",left:x,top:y,zIndex:9999,pointerEvents:"none",fontWeight:900,fontSize:18,fontFamily:"'Rajdhani',sans-serif",color,textShadow:`0 0 12px ${color}`,animation:"xpFloat 1.3s ease-out forwards"}}>{text}</div>;
}
function AchToast({ach,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,3500);return()=>clearTimeout(t);},[]);
  return <div style={{position:"fixed",bottom:90,right:14,zIndex:9997,background:"#0F0F1A",border:"1px solid #A78BFA",borderRadius:14,padding:"14px 16px",display:"flex",gap:12,alignItems:"center",boxShadow:"0 0 40px #A78BFA44",animation:"toastR .4s ease-out forwards",maxWidth:290}}><div style={{fontSize:30}}>{ach.icon}</div><div><div style={{fontSize:9,color:"#A78BFA",letterSpacing:3,marginBottom:2}}>LOGRO DESBLOQUEADO</div><div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{ach.name}</div><div style={{fontSize:11,color:"#A78BFA",fontWeight:700,marginTop:3}}>+{ach.xp} XP</div></div></div>;
}
function CoinToast({msg,coins,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,3500);return()=>clearTimeout(t);},[]);
  return <div style={{position:"fixed",bottom:90,left:14,zIndex:9997,background:"#0F0F1A",border:"1px solid #F59E0B",borderRadius:14,padding:"14px 16px",display:"flex",gap:12,alignItems:"center",boxShadow:"0 0 40px #F59E0B44",animation:"toastL .4s ease-out forwards",maxWidth:290}}><div style={{fontSize:28}}>🪙</div><div><div style={{fontSize:9,color:"#F59E0B",letterSpacing:3,marginBottom:2}}>RECOMPENSA</div><div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{msg}</div><div style={{fontSize:12,color:"#F59E0B",fontWeight:700,marginTop:3}}>+{coins} monedas</div></div></div>;
}
function LevelUpModal({level,onClose}){
  const ri=getRank(level);
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.9)",backdropFilter:"blur(10px)"}}><div style={{background:"#0A0A12",border:`2px solid ${ri.color}`,borderRadius:20,padding:"44px 48px",textAlign:"center",maxWidth:320,width:"90%",boxShadow:`0 0 80px ${ri.color}88`,animation:"lvlPop .5s cubic-bezier(.34,1.56,.64,1) forwards"}}><div style={{marginBottom:10,display:"flex",justifyContent:"center"}}><HelmIcon size={64} glow={ri.color}/></div><div style={{fontSize:10,letterSpacing:6,color:ri.color,marginBottom:6}}>SISTEMA RANKUP</div><div style={{fontSize:46,fontWeight:900,color:"#FFF",fontFamily:"'Cinzel',serif",lineHeight:1}}>NIVEL {level}</div><div style={{fontSize:16,color:ri.color,marginTop:10,fontWeight:700,letterSpacing:2}}>[{ri.rank}] {ri.title}</div><div style={{fontSize:12,color:"#555",marginTop:28}}>Toca para continuar</div></div></div>;
}
function RedeemModal({reward,coins,onClose}){
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.92)",backdropFilter:"blur(10px)"}}><div onClick={e=>e.stopPropagation()} style={{background:"#0D0D1A",border:"2px solid #F59E0B",borderRadius:20,padding:"40px 36px",textAlign:"center",maxWidth:300,width:"90%",boxShadow:"0 0 80px #F59E0B88",animation:"coinPop .5s cubic-bezier(.34,1.56,.64,1) forwards"}}><div style={{fontSize:56,marginBottom:10}}>{reward.icon}</div><div style={{fontSize:10,letterSpacing:5,color:"#F59E0B",marginBottom:8}}>RECOMPENSA CANJEADA</div><div style={{fontSize:20,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",marginBottom:6}}>{reward.name}</div><div style={{fontSize:12,color:"#888",lineHeight:1.5,marginBottom:16}}>{reward.desc}</div><div style={{fontSize:14,color:"#F59E0B",fontWeight:700,marginBottom:24}}>−{reward.cost} 🪙 · Saldo: {coins} 🪙</div><button onClick={onClose} style={{width:"100%",padding:12,background:"linear-gradient(135deg,#F59E0B,#D97706)",border:"none",borderRadius:10,color:"#07070F",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>¡A DISFRUTARLO!</button></div></div>;
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({onLogin}){
  const [mode,setMode]=useState("login");
  const [step,setStep]=useState(1); // register step 1=creds, 2=profile
  const [email,setEmail]=useState(""), [password,setPassword]=useState(""), [name,setName]=useState("");
  const [sex,setSex]=useState(""), [birthdate,setBirthdate]=useState(""), [height,setHeight]=useState(""), [weight,setWeight]=useState("");
  const [error,setError]=useState(""), [shake,setShake]=useState(false), [showPw,setShowPw]=useState(false);
  const err=msg=>{setError(msg);setShake(true);setTimeout(()=>setShake(false),600);};
  const calcAge=bd=>{if(!bd)return 0;const b=new Date(bd),t=new Date();let a=t.getFullYear()-b.getFullYear();if(t<new Date(t.getFullYear(),b.getMonth(),b.getDate()))a--;return a;};
  const calcIMC=(w,h)=>h>0?Math.round((w/(h/100)**2)*10)/10:0;

  const doLogin=async()=>{
    const emailKey=email.toLowerCase().trim();
    if(emailKey===ADMIN_EMAIL){
      if(hashPw(password)!==ADMIN_PASSWORD) return err("Contraseña de administrador incorrecta");
      // Sync all users from Firebase for admin
      await syncUsersFromFirebase();
      setSession(ADMIN_EMAIL); onLogin(ADMIN_EMAIL,"Administrador",true); return;
    }
    // Sync from Firebase first, then check locally
    await syncFromFirebase(emailKey);
    const users=getUsers(), u=users[emailKey];
    if(!u) return err("Email no registrado");
    if(u.password!==hashPw(password)) return err("Contraseña incorrecta");
    setSession(emailKey); onLogin(emailKey,u.name,false);
  };

  const goStep2=()=>{
    if(!name.trim()) return err("Escribe tu nombre de jugador");
    if(!email.includes("@")) return err("Email inválido");
    if(password.length<6) return err("Contraseña mínimo 6 caracteres");
    const users=getUsers(), key=email.toLowerCase().trim();
    if(users[key]) return err("Email ya registrado");
    setError(""); setStep(2);
  };

  const doRegister=async()=>{
    if(!sex) return err("Selecciona tu sexo");
    if(!birthdate) return err("Selecciona tu fecha de nacimiento");
    const age=calcAge(birthdate);
    if(age<10||age>99) return err("Edad inválida");
    const users=getUsers(), key=email.toLowerCase().trim();
    users[key]={name:name.trim(),password:hashPw(password),createdAt:Date.now(),sex,birthdate,age,height:parseInt(height)||0,weight:parseFloat(weight)||0};
    // Save locally first (instant), then Firebase in background
    localStorage.setItem("rku_users", JSON.stringify(users));
    localStorage.removeItem(`rku_data_${key}`);
    const initData={totalXp:0,coins:0,checked:{},weights:{},personalRecords:{},earnedAchs:[],redeemedRewards:[],dungeonCoins:{},customRoutines:[],playerClass:null,assignedDiets:[],assignedProgram:null};
    localStorage.setItem(`rku_data_${key}`, JSON.stringify(initData));
    // Firebase in background - don't await
    saveUsers(users).catch(()=>{});
    saveUserData(key, initData).catch(()=>{});
    setSession(key); onLogin(key,name.trim(),false);
  };

  const inp={width:"100%",padding:"14px 16px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:10,color:"#FFF",fontSize:14,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:10,boxSizing:"border-box"};

  return(
    <div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#07070F",padding:24}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{marginBottom:12,display:"flex",justifyContent:"center"}}>
          <HelmIcon size={88} glow="#A78BFA"/>
        </div>
        <div style={{fontSize:9,letterSpacing:6,color:"#444",marginBottom:6}}> </div>
        <div style={{fontSize:32,fontWeight:900,color:"#FFF",fontFamily:"'Cinzel',serif",lineHeight:1}}>RANKUP</div>
      </div>

      <div className={shake?"shake":""} style={{width:"100%",maxWidth:360,background:"#0D0D1A",border:"1px solid #A78BFA33",borderRadius:20,padding:28}}>
        {/* Tabs */}
        <div style={{display:"flex",gap:8,marginBottom:24}}>
          {["login","register"].map(m=>(
            <button key={m} onClick={()=>{setMode(m);setError("");setStep(1);}} style={{flex:1,padding:10,borderRadius:8,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:12,fontWeight:700,letterSpacing:2,background:mode===m?"#A78BFA22":"transparent",border:`1px solid ${mode===m?"#A78BFA":"#1E1E32"}`,color:mode===m?"#A78BFA":"#555"}}>
              {m==="login"?"ENTRAR":"REGISTRO"}
            </button>
          ))}
        </div>

        {mode==="login"&&(
          <>
            <input style={inp} placeholder="📧 Email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
            <div style={{position:"relative"}}>
              <input style={{...inp,paddingRight:48}} placeholder="🔒 Contraseña" type={showPw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
              <button onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:14,background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:16}}>{showPw?"🙈":"👁"}</button>
            </div>
            {error&&<div style={{fontSize:12,color:"#F87171",marginBottom:10,textAlign:"center",padding:"8px 12px",background:"#F8717122",borderRadius:8}}>{error}</div>}
            <button onClick={doLogin} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#A78BFA,#7C3AED)",border:"none",borderRadius:10,color:"#FFF",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2,marginTop:4}}>⚔️ ENTRAR A RANKUP</button>
          </>
        )}

        {mode==="register"&&step===1&&(
          <>
            <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3,marginBottom:12}}>PASO 1 DE 2 · CUENTA</div>
            <input style={inp} placeholder="🗡️ Tu nombre de jugador" value={name} onChange={e=>setName(e.target.value)}/>
            <input style={inp} placeholder="📧 Email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
            <div style={{position:"relative"}}>
              <input style={{...inp,paddingRight:48}} placeholder="🔒 Contraseña (mín 6 caracteres)" type={showPw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)}/>
              <button onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:14,background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:16}}>{showPw?"🙈":"👁"}</button>
            </div>
            {error&&<div style={{fontSize:12,color:"#F87171",marginBottom:10,textAlign:"center",padding:"8px 12px",background:"#F8717122",borderRadius:8}}>{error}</div>}
            <button onClick={goStep2} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#A78BFA,#7C3AED)",border:"none",borderRadius:10,color:"#FFF",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2,marginTop:4}}>SIGUIENTE →</button>
          </>
        )}

        {mode==="register"&&step===2&&(
          <>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
              <button onClick={()=>{setStep(1);setError("");}} style={{background:"none",border:"none",color:"#A78BFA",cursor:"pointer",fontSize:14,padding:0}}>←</button>
              <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3}}>PASO 2 DE 2 · PERFIL FÍSICO</div>
            </div>

            {/* Sex selector */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:8}}>SEXO</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[{v:"M",l:"♂ Masculino"},{v:"F",l:"♀ Femenino"}].map(s=>(
                  <button key={s.v} onClick={()=>setSex(s.v)} style={{padding:"12px 8px",borderRadius:10,cursor:"pointer",background:sex===s.v?"#A78BFA22":"#07070F",border:`1.5px solid ${sex===s.v?"#A78BFA":"#2A2A44"}`,color:sex===s.v?"#A78BFA":"#555",fontSize:13,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",transition:"all .15s"}}>
                    {s.l}
                  </button>
                ))}
              </div>
            </div>

            {/* Birthdate calendar */}
            <div style={{marginBottom:4}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:6}}>FECHA DE NACIMIENTO</div>
              <input style={{...inp,marginBottom:4}} type="date" value={birthdate}
                max={new Date(new Date().setFullYear(new Date().getFullYear()-10)).toISOString().split("T")[0]}
                min={new Date(new Date().setFullYear(new Date().getFullYear()-80)).toISOString().split("T")[0]}
                onChange={e=>setBirthdate(e.target.value)}/>
              {birthdate&&<div style={{fontSize:10,color:"#A78BFA",marginBottom:4}}>🎂 {calcAge(birthdate)} años</div>}
            </div>

            {/* Height & Weight */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
              <div>
                <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:6}}>ALTURA (cm)</div>
                <input style={{...inp,marginBottom:0}} placeholder="170" type="number" value={height} onChange={e=>setHeight(e.target.value)}/>
              </div>
              <div>
                <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:6}}>PESO (kg)</div>
                <input style={{...inp,marginBottom:0}} placeholder="70.5" type="number" step="0.1" value={weight} onChange={e=>setWeight(e.target.value)}/>
              </div>
            </div>
            {height&&weight&&(()=>{
              const imc=calcIMC(parseFloat(weight),parseFloat(height));
              const imcLabel=imc<18.5?"Bajo peso":imc<25?"Peso normal":imc<30?"Sobrepeso":"Obesidad";
              const imcColor=imc<18.5?"#60A5FA":imc<25?"#34D399":imc<30?"#FBBF24":"#F87171";
              return <div style={{padding:"8px 12px",background:`${imcColor}14`,border:`1px solid ${imcColor}33`,borderRadius:8,marginTop:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:10,color:"#555"}}>IMC</span>
                <span style={{fontSize:13,fontWeight:700,color:imcColor}}>{imc} — {imcLabel}</span>
              </div>;
            })()}
            <div style={{fontSize:10,color:"#333",marginBottom:14,marginTop:6}}>Altura y peso opcionales · Para calcular tu IMC</div>

            {error&&<div style={{fontSize:12,color:"#F87171",marginBottom:10,textAlign:"center",padding:"8px 12px",background:"#F8717122",borderRadius:8}}>{error}</div>}
            <button onClick={doRegister} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#A78BFA,#7C3AED)",border:"none",borderRadius:10,color:"#FFF",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>🗡️ CREAR CUENTA</button>
          </>
        )}

        <div style={{textAlign:"center",marginTop:20,fontSize:11,color:"#444"}}>
          {mode==="login"?<span>¿Sin cuenta? <button onClick={()=>{setMode("register");setStep(1);setError("");}} style={{background:"none",border:"none",color:"#A78BFA",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:11,fontWeight:700}}>REGÍSTRATE</button></span>:<span>¿Ya tienes cuenta? <button onClick={()=>{setMode("login");setError("");}} style={{background:"none",border:"none",color:"#A78BFA",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:11,fontWeight:700}}>ENTRA</button></span>}
        </div>
      </div>
      <div style={{marginTop:20,fontSize:10,color:"#2A2A44",letterSpacing:3}}>DATOS GUARDADOS EN TU DISPOSITIVO</div>
    </div>
  );
}

// ─── PROGRAM TEMPLATES ────────────────────────────────────────────────────────
// Built-in templates available in the admin panel
const PROGRAM_TEMPLATES = [
  {
    id:"tpl_90dias",
    name:"Programa 90 Días",
    icon:"⚔️",
    color:"#E8C547",
    desc:"Programa completo de 3 fases (12 semanas) de transformación física.",
    phases: PHASES,
  }
];


// ─── FOOD DATABASE ───────────────────────────────────────────────────────────
const FOOD_DB = [
  // ── PLATOS PRINCIPALES ──────────────────────────────────────────────────────
  {id:"f001",name:"Pechuga de pollo a la plancha", cat:"plato", goal:["volumen","definicion","recomp"], kcal:165, protein:31, carbs:0,  fat:3,  prep:"15min", desc:"Proteína magra por excelencia. A la plancha con aceite de oliva y especias."},
  {id:"f002",name:"Salmón al horno",               cat:"plato", goal:["volumen","recomp"],              kcal:208, protein:28, carbs:0,  fat:10, prep:"20min", desc:"Rico en omega-3 y proteína de alta calidad."},
  {id:"f003",name:"Merluza al vapor",              cat:"plato", goal:["definicion","recomp"],           kcal:90,  protein:18, carbs:0,  fat:1,  prep:"15min", desc:"Pescado blanco con muy pocas calorías y alto valor proteico."},
  {id:"f004",name:"Atún con tomate",               cat:"plato", goal:["definicion","recomp"],           kcal:150, protein:25, carbs:5,  fat:3,  prep:"10min", desc:"Rápido, económico y muy proteico. Ideal para cualquier comida."},
  {id:"f005",name:"Tortilla de claras",            cat:"plato", goal:["definicion","recomp"],           kcal:120, protein:22, carbs:1,  fat:3,  prep:"10min", desc:"Claras de huevo batidas. Proteína rápida con mínima grasa."},
  {id:"f006",name:"Huevos revueltos",              cat:"plato", goal:["volumen","recomp"],              kcal:200, protein:14, carbs:1,  fat:15, prep:"10min", desc:"3 huevos enteros. Proteínas completas con grasas saludables."},
  {id:"f007",name:"Arroz con pollo",               cat:"plato", goal:["volumen"],                       kcal:380, protein:35, carbs:42, fat:5,  prep:"30min", desc:"Comida completa de musculación. Carbohidratos complejos + proteína."},
  {id:"f008",name:"Pasta con pechuga",             cat:"plato", goal:["volumen"],                       kcal:420, protein:36, carbs:52, fat:5,  prep:"25min", desc:"Pasta integral con pechuga. Carga de carbohidratos con proteína."},
  {id:"f009",name:"Lentejas con verduras",         cat:"plato", goal:["volumen","recomp"],              kcal:260, protein:18, carbs:38, fat:3,  prep:"35min", desc:"Legumbre completa. Proteína vegetal, hierro y carbohidratos complejos."},
  {id:"f010",name:"Garbanzos con espinacas",       cat:"plato", goal:["volumen","recomp"],              kcal:240, protein:14, carbs:32, fat:5,  prep:"30min", desc:"Alto en fibra, hierro y proteína vegetal."},
  {id:"f011",name:"Filete de ternera",             cat:"plato", goal:["volumen"],                       kcal:220, protein:30, carbs:0,  fat:10, prep:"15min", desc:"Proteína completa con creatina natural y hierro hemo."},
  {id:"f012",name:"Pavo a la plancha",             cat:"plato", goal:["definicion","recomp"],           kcal:155, protein:29, carbs:0,  fat:3,  prep:"15min", desc:"Más bajo en grasa que el pollo. Ideal en fase de definición."},
  {id:"f013",name:"Gambas al ajillo",              cat:"plato", goal:["definicion","recomp"],           kcal:140, protein:24, carbs:1,  fat:4,  prep:"15min", desc:"Marisco bajo en calorías y grasa con alta proteína."},
  {id:"f014",name:"Ensalada de atún",              cat:"plato", goal:["definicion"],                    kcal:180, protein:22, carbs:8,  fat:5,  prep:"10min", desc:"Atún, tomate, pepino y lechuga. Comida de definición rápida."},
  {id:"f015",name:"Bowl de arroz y salmón",        cat:"plato", goal:["volumen","recomp"],              kcal:450, protein:34, carbs:48, fat:11, prep:"20min", desc:"Poke bowl proteico. Grasas omega-3 con carbohidratos complejos."},
  {id:"f016",name:"Tortitas de avena y plátano",   cat:"plato", goal:["volumen"],                       kcal:280, protein:12, carbs:42, fat:6,  prep:"15min", desc:"Desayuno de musculación. Carbohidratos lentos con proteína de huevo."},
  {id:"f017",name:"Quinoa con verduras",           cat:"plato", goal:["recomp","definicion"],           kcal:230, protein:10, carbs:34, fat:4,  prep:"20min", desc:"Proteína completa vegetal. Los 9 aminoácidos esenciales."},
  {id:"f018",name:"Pollo al curry con arroz",      cat:"plato", goal:["volumen"],                       kcal:400, protein:36, carbs:44, fat:8,  prep:"30min", desc:"Comida completa. Antiinflamatorio por las especias."},
  {id:"f019",name:"Bacalao al pil-pil",            cat:"plato", goal:["definicion","recomp"],           kcal:180, protein:26, carbs:2,  fat:7,  prep:"25min", desc:"Pescado blanco con grasas saludables del aceite de oliva."},
  {id:"f020",name:"Estofado de pollo y legumbres", cat:"plato", goal:["volumen","recomp"],              kcal:360, protein:34, carbs:30, fat:7,  prep:"40min", desc:"Plato completo rico en proteína, fibra y micronutrientes."},
  {id:"f021",name:"Batata asada con queso cottage",cat:"plato", goal:["recomp"],                        kcal:290, protein:18, carbs:38, fat:4,  prep:"35min", desc:"Carbohidrato de bajo IG con proteína de digestión lenta."},
  {id:"f022",name:"Wraps de pavo y aguacate",      cat:"plato", goal:["recomp","volumen"],              kcal:340, protein:28, carbs:26, fat:12, prep:"10min", desc:"Comida rápida con proteína, grasas saludables y carbohidratos."},
  {id:"f023",name:"Sopa de pollo y verduras",      cat:"plato", goal:["definicion"],                    kcal:140, protein:18, carbs:10, fat:3,  prep:"30min", desc:"Baja en calorías. Hidratante y saciante en fase de corte."},
  {id:"f024",name:"Revuelto de setas y jamón",     cat:"plato", goal:["definicion","recomp"],           kcal:170, protein:16, carbs:4,  fat:9,  prep:"15min", desc:"Bajo en carbohidratos con buena proteína y grasas saludables."},
  {id:"f025",name:"Tarta de queso proteica",       cat:"plato", goal:["recomp"],                        kcal:220, protein:20, carbs:14, fat:8,  prep:"60min", desc:"Versión fitness con queso cottage y claras de huevo."},

  // ── BEBIDAS ─────────────────────────────────────────────────────────────────
  {id:"f026",name:"Batido de proteína whey",       cat:"bebida",goal:["volumen","definicion","recomp"], kcal:120, protein:25, carbs:3,  fat:2,  prep:"2min",  desc:"25g proteína de suero. Absorción rápida post-entreno."},
  {id:"f027",name:"Batido de caseína nocturno",    cat:"bebida",goal:["volumen","recomp"],              kcal:130, protein:24, carbs:4,  fat:2,  prep:"2min",  desc:"Proteína de absorción lenta. Ideal antes de dormir."},
  {id:"f028",name:"Batido de plátano y avena",     cat:"bebida",goal:["volumen"],                       kcal:380, protein:18, carbs:56, fat:6,  prep:"5min",  desc:"Gainer natural. Carbohidratos complejos + proteína pre-entreno."},
  {id:"f029",name:"Batido verde energético",       cat:"bebida",goal:["definicion","recomp"],           kcal:90,  protein:5,  carbs:12, fat:1,  prep:"5min",  desc:"Espinacas, manzana, jengibre y limón. Vitaminas y antioxidantes."},
  {id:"f030",name:"Agua con limón en ayunas",      cat:"bebida",goal:["definicion"],                    kcal:5,   protein:0,  carbs:1,  fat:0,  prep:"1min",  desc:"Activa el metabolismo. Alcalinizante y digestivo."},
  {id:"f031",name:"Café solo pre-entreno",         cat:"bebida",goal:["definicion","recomp"],           kcal:5,   protein:0,  carbs:0,  fat:0,  prep:"2min",  desc:"Cafeína natural. Mejora el rendimiento y quema de grasa."},
  {id:"f032",name:"Té verde",                      cat:"bebida",goal:["definicion"],                    kcal:0,   protein:0,  carbs:0,  fat:0,  prep:"5min",  desc:"Catequinas antioxidantes. Ligero efecto termogénico."},
  {id:"f033",name:"Leche de avena",                cat:"bebida",goal:["volumen"],                       kcal:130, protein:4,  carbs:24, fat:2,  prep:"1min",  desc:"Alternativa vegetal con beta-glucanos. Energía sostenida."},
  {id:"f034",name:"Kéfir natural",                 cat:"bebida",goal:["recomp","definicion"],           kcal:60,  protein:6,  carbs:5,  fat:1,  prep:"1min",  desc:"Probióticos para la microbiota intestinal. Mejora la absorción."},
  {id:"f035",name:"Zumo de remolacha",             cat:"bebida",goal:["volumen","recomp"],              kcal:70,  protein:2,  carbs:15, fat:0,  prep:"5min",  desc:"Nitratos naturales. Mejora el flujo sanguíneo y el rendimiento."},
  {id:"f036",name:"Batido de fresa y proteína",    cat:"bebida",goal:["recomp","definicion"],           kcal:140, protein:24, carbs:10, fat:2,  prep:"3min",  desc:"Proteína whey con fresas frescas. Rico en vitamina C."},
  {id:"f037",name:"Agua de coco",                  cat:"bebida",goal:["volumen","recomp"],              kcal:45,  protein:0,  carbs:9,  fat:0,  prep:"1min",  desc:"Electrolitos naturales. Hidratación post-entreno."},
  {id:"f038",name:"Batido de chocolate y cacahuete",cat:"bebida",goal:["volumen"],                      kcal:420, protein:30, carbs:38, fat:14, prep:"5min",  desc:"Gainer de sabor. Proteína, carbos y grasas en ratio de volumen."},
  {id:"f039",name:"Limonada sin azúcar",           cat:"bebida",goal:["definicion"],                    kcal:10,  protein:0,  carbs:2,  fat:0,  prep:"5min",  desc:"Hidratante y saciante. Vitamina C sin calorías extra."},
  {id:"f040",name:"Infusión de cúrcuma y jengibre",cat:"bebida",goal:["definicion","recomp"],           kcal:5,   protein:0,  carbs:1,  fat:0,  prep:"8min",  desc:"Antiinflamatoria natural. Mejora la recuperación muscular."},

  // ── SNACKS / COMIDAS INTERMEDIAS ─────────────────────────────────────────────
  {id:"f041",name:"Yogur griego natural 0%",       cat:"snack", goal:["definicion","recomp"],           kcal:60,  protein:10, carbs:4,  fat:0,  prep:"1min",  desc:"Proteína de digestión lenta. Base perfecta para snacks fitness."},
  {id:"f042",name:"Yogur griego con frutas",       cat:"snack", goal:["volumen","recomp"],              kcal:140, protein:10, carbs:18, fat:1,  prep:"3min",  desc:"Probióticos + fructosa natural. Pre-entreno ligero."},
  {id:"f043",name:"Queso cottage",                 cat:"snack", goal:["definicion","recomp"],           kcal:72,  protein:12, carbs:3,  fat:1,  prep:"1min",  desc:"Caseína natural. Snack nocturno ideal para preservar músculo."},
  {id:"f044",name:"Plátano",                       cat:"snack", goal:["volumen"],                       kcal:89,  protein:1,  carbs:23, fat:0,  prep:"0min",  desc:"Carbohidrato rápido natural. Pre-entreno o post-entreno."},
  {id:"f045",name:"Manzana con mantequilla almendra",cat:"snack",goal:["recomp"],                       kcal:180, protein:4,  carbs:22, fat:9,  prep:"3min",  desc:"Fibra + grasas saludables. Snack saciante de media tarde."},
  {id:"f046",name:"Puñado de almendras",           cat:"snack", goal:["recomp","volumen"],              kcal:160, protein:6,  carbs:6,  fat:14, prep:"0min",  desc:"Grasas monoinsaturadas y vitamina E. Saciante y antiinflamatorio."},
  {id:"f047",name:"Arroz de tortitas de arroz",    cat:"snack", goal:["definicion","volumen"],          kcal:70,  protein:1,  carbs:16, fat:0,  prep:"0min",  desc:"Carbohidrato simple limpio. Fácil digestión pre-entreno."},
  {id:"f048",name:"Huevo duro",                    cat:"snack", goal:["recomp","definicion"],           kcal:77,  protein:6,  carbs:1,  fat:5,  prep:"10min", desc:"Proteína completa portable. Saciante con pocos carbohidratos."},
  {id:"f049",name:"Edamame",                       cat:"snack", goal:["recomp","definicion"],           kcal:120, protein:11, carbs:9,  fat:5,  prep:"5min",  desc:"Proteína vegetal completa. Rico en fibra y minerales."},
  {id:"f050",name:"Tosta con pavo y queso fresco", cat:"snack", goal:["recomp","volumen"],              kcal:150, protein:14, carbs:14, fat:4,  prep:"5min",  desc:"Proteína + carbos en snack rápido. Ideal a media mañana."},

  // ── POSTRES ──────────────────────────────────────────────────────────────────
  {id:"f051",name:"Mousse de proteína de chocolate",cat:"postre",goal:["definicion","recomp"],          kcal:140, protein:18, carbs:10, fat:3,  prep:"10min", desc:"Whey + cacao puro batido con queso cottage. Postre fitness."},
  {id:"f052",name:"Gelato de plátano congelado",   cat:"postre",goal:["volumen","recomp"],              kcal:90,  protein:1,  carbs:22, fat:0,  prep:"5min",  desc:"Un solo ingrediente. Plátano congelado batido. Sin azúcar añadida."},
  {id:"f053",name:"Brownie proteico de avena",     cat:"postre",goal:["volumen","recomp"],              kcal:180, protein:14, carbs:20, fat:5,  prep:"25min", desc:"Avena + whey + cacao. Postre que se siente trampa sin serlo."},
  {id:"f054",name:"Cacao con leche de avena",      cat:"postre",goal:["volumen"],                       kcal:160, protein:5,  carbs:28, fat:3,  prep:"5min",  desc:"Carbohidratos y antioxidantes del cacao. Post-entreno nocturno."},
  {id:"f055",name:"Flan de claras",                cat:"postre",goal:["definicion","recomp"],           kcal:90,  protein:12, carbs:8,  fat:1,  prep:"30min", desc:"Postre proteico clásico. Muy bajo en grasa y saciante."},
  {id:"f056",name:"Fresas con nata 0%",            cat:"postre",goal:["definicion"],                    kcal:60,  protein:3,  carbs:10, fat:0,  prep:"5min",  desc:"Antioxidantes de la fresa con proteína de la nata desnatada."},
  {id:"f057",name:"Tarta de queso sin horno",      cat:"postre",goal:["recomp"],                        kcal:200, protein:16, carbs:16, fat:6,  prep:"15min", desc:"Queso cottage, proteína en polvo y fruta. Sin horno ni harina."},
  {id:"f058",name:"Galletas de avena y cacahuete", cat:"postre",goal:["volumen"],                       kcal:120, protein:5,  carbs:15, fat:5,  prep:"20min", desc:"3 ingredientes. Avena, plátano y mantequilla de cacahuete."},
  {id:"f059",name:"Helado de proteína casero",     cat:"postre",goal:["definicion","recomp"],           kcal:110, protein:14, carbs:10, fat:2,  prep:"240min",desc:"Whey + leche desnatada + xantana congelado. Textura de helado real."},
  {id:"f060",name:"Natillas de vainilla proteicas",cat:"postre",goal:["recomp","definicion"],           kcal:130, protein:16, carbs:10, fat:3,  prep:"15min", desc:"Queso cottage con vainilla y edulcorante. Alta proteína y cremoso."},
  {id:"f061",name:"Muffins de arándanos y proteína",cat:"postre",goal:["volumen","recomp"],             kcal:160, protein:12, carbs:18, fat:4,  prep:"30min", desc:"Harina de avena + whey + arándanos. Postre de volumen limpio."},
  {id:"f062",name:"Crema de cacahuete en tortita", cat:"postre",goal:["volumen"],                       kcal:200, protein:8,  carbs:20, fat:10, prep:"3min",  desc:"Tortita de arroz con mantequilla de cacahuete natural. Rápido."},
  {id:"f063",name:"Bizcocho de proteína y plátano",cat:"postre",goal:["volumen"],                       kcal:190, protein:15, carbs:22, fat:4,  prep:"35min", desc:"Plátano maduro + whey + avena. Sin azúcar añadida."},
  {id:"f064",name:"Sorbete de mango",              cat:"postre",goal:["definicion"],                    kcal:70,  protein:1,  carbs:17, fat:0,  prep:"120min",desc:"Mango congelado batido. Refrescante y bajo en calorías."},
  {id:"f065",name:"Crepés proteicas",              cat:"postre",goal:["recomp","volumen"],              kcal:170, protein:18, carbs:16, fat:4,  prep:"20min", desc:"Claras + whey + avena. Crepés flexibles rellenas de lo que quieras."},
];

const FOOD_CATS  = ["todos","plato","bebida","snack","postre"];
const FOOD_GOALS = ["todos","volumen","definicion","recomp"];
const CAT_LABELS = {plato:"🍽️ Plato",bebida:"🥤 Bebida",snack:"🥜 Snack",postre:"🍮 Postre"};
const GOAL_LABELS= {volumen:"💪 Volumen",definicion:"🔥 Definición",recomp:"⚗️ Recomp"};
const GOAL_COLORS= {volumen:"#F87171",definicion:"#34D399",recomp:"#F59E0B"};


function BodySVG({view, muscleXP, sex="M"}){
  const F = sex==="F";
  const xp = id => muscleXP[id]||0;
  const mc = id => {
    const v=xp(id);
    if(v>0){const r=getMR(v);return{fill:r.color+"55",stroke:r.color,sw:1.3,glow:r.color};}
    return{fill:"#0BF4FF12",stroke:"#0BF4FF",sw:0.55,glow:null};
  };
  const M = (id,d,o=1) => {
    const s=mc(id);
    return <path d={d} fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} opacity={o}
      style={s.glow?{filter:`drop-shadow(0 0 5px ${s.glow}) drop-shadow(0 0 10px ${s.glow}77)`}:{}}/>;
  };
  const E = (id,cx,cy,rx,ry,o=1) => {
    const s=mc(id);
    return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} opacity={o}
      style={s.glow?{filter:`drop-shadow(0 0 5px ${s.glow})`}:{}}/>;
  };
  const N = "#0BF4FF";
  const base = (d,o=0.28) => <path d={d} fill="#0BF4FF0E" stroke={N} strokeWidth={0.5} opacity={o}/>;
  const line = (x1,y1,x2,y2,o=0.3) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={N} strokeWidth={0.45} opacity={o}/>;
  const ell  = (cx,cy,rx,ry,o=0.28) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#0BF4FF0A" stroke={N} strokeWidth={0.45} opacity={o}/>;

  // ── proportions ──────────────────────────────────────────────────────────────
  // Viewbox 100 × 320. Center x=50.
  const SH = F?19:25;   // shoulder half-width — man much broader
  const CW = F?13:18;   // chest half-width
  const WW = F?10:15;   // waist — woman much narrower waist
  const HW = F?20:16;   // hip half-width — woman wider hips
  const NK = F?4:5;     // neck half-width — man thicker neck

  // ── skeleton / silhouette ────────────────────────────────────────────────────
  const skeleton = (
    <>
      <defs>
        <radialGradient id="hg" cx="50%" cy="20%" r="65%">
          <stop offset="0%" stopColor="#0BF4FF" stopOpacity="0.13"/>
          <stop offset="100%" stopColor="#0BF4FF" stopOpacity="0.01"/>
        </radialGradient>
      </defs>
      {/* scan lines */}
      {Array.from({length:26},(_,i)=>10+i*11).map(y=>(
        <line key={y} x1="8" y1={y} x2="92" y2={y} stroke={N} strokeWidth="0.12" opacity="0.04"/>
      ))}
      {/* head */}
      {ell(50, F?13:15, F?9:11, F?12:13, 0.5)}
      {/* neck — thicker for male */}
      {base(F?`M${50-NK} 23 L${50-NK} 32 L${50+NK} 32 L${50+NK} 23Z`:`M${50-NK} 26 L${50-NK} 36 L${50+NK} 36 L${50+NK} 26Z`, 0.4)}
      {/* female hair bun top */}
      {F && <ellipse cx="50" cy={F?5:0} rx="7" ry="5" fill="#0BF4FF0A" stroke={N} strokeWidth="0.4" opacity="0.35"/>}
      {/* torso — hourglass for female, V-taper for male */}
      {base(`M${50-SH} ${F?32:36} C${50-SH-3} ${F?42:44} ${50-CW-1} ${F?54:56} ${50-CW} ${F?66:68} C${50-WW-2} ${F?86:88} ${50-WW} ${F?98:100} ${50-HW} ${F?118:116} L${50-HW} ${F?134:132} L${50+HW} ${F?134:132} C${50+HW} ${F?118:116} ${50+WW+2} ${F?98:100} ${50+WW} ${F?86:88} C${50+CW+1} ${F?54:56} ${50+CW} ${F?66:68} ${50+SH+3} ${F?42:44} L${50+SH} ${F?32:36} Z`, 0.2)}
      {/* female breast silhouette — outline only, no fill */}
      {F && view==="front" && (
        <path d={`M${50-CW+2} 64 C${50-CW-4} 72 ${50-CW-2} 82 ${50-3} 84 C${50+3} 84 ${50+CW+2} 82 ${50+CW+4} 72 C${50+CW-2} 64 ${50+CW-2} 64 Z`}
          fill="none" stroke={N} strokeWidth="0.4" opacity="0.28"/>
      )}
      {/* upper arms */}
      {base(`M${50-SH} ${F?36:40} C${50-SH-10} ${F?42:46} ${50-SH-12} ${F?64:68} ${50-SH-10} ${F?82:86} L${50-SH-5} ${F?84:88} L${50-SH} ${F?66:70} L${50-SH+1} ${F?38:42} Z`, 0.22)}
      {base(`M${50+SH} ${F?36:40} C${50+SH+10} ${F?42:46} ${50+SH+12} ${F?64:68} ${50+SH+10} ${F?82:86} L${50+SH+5} ${F?84:88} L${50+SH} ${F?66:70} L${50+SH-1} ${F?38:42} Z`, 0.22)}
      {/* forearms */}
      {base(F?"M28 86 C24 96 22 112 23 126 L28 128 L31 114 L31 88Z":"M26 88 C22 98 20 114 21 128 L26 130 L29 116 L29 90Z", 0.2)}
      {base(F?"M72 86 C76 96 78 112 77 126 L72 128 L69 114 L69 88Z":"M74 88 C78 98 80 114 79 128 L74 130 L71 116 L71 90Z", 0.2)}
      {/* hands */}
      {base(F?"M23 128 C21 136 22 142 27 143 L31 141 L31 128Z":"M21 130 C19 138 20 144 25 145 L29 143 L29 130Z", 0.2)}
      {base(F?"M77 128 C79 136 78 142 73 143 L69 141 L69 128Z":"M79 130 C81 138 80 144 75 145 L71 143 L71 130Z", 0.2)}
      {/* thighs — female wider gap between legs */}
      {base(`M${50-HW+1} ${F?134:132} C${50-HW-2} ${F?152:150} ${50-HW-2} ${F?180:178} ${50-HW} ${F?200:198} L${50-6} ${F?202:200} L${50-4} ${F?182:180} L${50-5} ${F?136:134} Z`, 0.22)}
      {base(`M${50+HW-1} ${F?134:132} C${50+HW+2} ${F?152:150} ${50+HW+2} ${F?180:178} ${50+HW} ${F?200:198} L${50+6} ${F?202:200} L${50+4} ${F?182:180} L${50+5} ${F?136:134} Z`, 0.22)}
      {/* knees */}
      {ell(50-HW+2, F?204:202, 7, 5, 0.28)}
      {ell(50+HW-2, F?204:202, 7, 5, 0.28)}
      {/* shins */}
      {base(`M${50-HW-1} ${F?210:208} C${50-HW-1} ${F?234:232} ${50-HW+1} ${F?258:256} ${50-HW+1} ${F?274:272} L${50-6} ${F?276:274} L${50-5} ${F?258:256} L${50-5} ${F?210:208} Z`, 0.2)}
      {base(`M${50+HW+1} ${F?210:208} C${50+HW+1} ${F?234:232} ${50+HW-1} ${F?258:256} ${50+HW-1} ${F?274:272} L${50+6} ${F?276:274} L${50+5} ${F?258:256} L${50+5} ${F?210:208} Z`, 0.2)}
      {/* feet */}
      {base(F?"M31 274 C29 282 30 288 36 290 L41 288 L41 274Z":"M31 276 C29 284 30 290 36 292 L41 290 L41 276Z", 0.2)}
      {base(F?"M69 274 C71 282 70 288 64 290 L59 288 L59 274Z":"M69 276 C71 284 70 290 64 292 L59 290 L59 276Z", 0.2)}
    </>
  );

  // ── FRONT MUSCLES ─────────────────────────────────────────────────────────
  const front = (
    <>
      {/* TRAPEZIUS — lighter, less intrusive */}
      {M("hombros", `M${50-6} ${F?30:34} L${50-SH+2} ${F?36:40} L${50-SH+4} ${F?44:48} L${50-3} ${F?42:46} L50 ${F?41:45} L${50+3} ${F?42:46} L${50+SH-4} ${F?44:48} L${50+SH-2} ${F?36:40} L${50+6} ${F?30:34} Z`, 0.55)}
      {/* DELTOID L */}
      {M("hombros", `M${50-SH+2} ${F?36:40} C${50-SH-6} ${F?42:46} ${50-SH-8} ${F?58:62} ${50-SH-6} ${F?70:74} L${50-SH-2} ${F?70:74} L${50-SH+1} ${F?56:60} L${50-SH+3} ${F?38:42} Z`, 0.82)}
      {/* DELTOID R */}
      {M("hombros", `M${50+SH-2} ${F?36:40} C${50+SH+6} ${F?42:46} ${50+SH+8} ${F?58:62} ${50+SH+6} ${F?70:74} L${50+SH+2} ${F?70:74} L${50+SH-1} ${F?56:60} L${50+SH-3} ${F?38:42} Z`, 0.82)}
      {/* PECTORAL L — cleaner shape, no overlap with delt */}
      {M("pecho", `M${50-SH+4} ${F?46:50} C${50-CW} ${F?52:56} ${50-CW} ${F?64:68} ${50-CW+1} ${F?78:82} C${50-CW+2} ${F?86:90} ${50-4} ${F?88:92} L${50-2} ${F?74:78} L${50-2} ${F?52:56} Z`, 0.85)}
      {/* PECTORAL R */}
      {M("pecho", `M${50+SH-4} ${F?46:50} C${50+CW} ${F?52:56} ${50+CW} ${F?64:68} ${50+CW-1} ${F?78:82} C${50+CW-2} ${F?86:90} ${50+4} ${F?88:92} L${50+2} ${F?74:78} L${50+2} ${F?52:56} Z`, 0.85)}
      {line(50, F?48:52, 50, F?90:94, 0.4)}
      {/* BICEP L */}
      {M("biceps", `M${50-SH-2} ${F?56:60} C${50-SH-11} ${F?62:66} ${50-SH-12} ${F?76:80} ${50-SH-10} ${F?90:94} L${50-SH-5} ${F?92:96} L${50-SH-2} ${F?78:82} L${50-SH+1} ${F?58:62} Z`, 0.88)}
      {line(50-SH-7, F?62:66, 50-SH-8, F?88:92, 0.38)}
      {/* BICEP R */}
      {M("biceps", `M${50+SH+2} ${F?56:60} C${50+SH+11} ${F?62:66} ${50+SH+12} ${F?76:80} ${50+SH+10} ${F?90:94} L${50+SH+5} ${F?92:96} L${50+SH+2} ${F?78:82} L${50+SH-1} ${F?58:62} Z`, 0.88)}
      {line(50+SH+7, F?62:66, 50+SH+8, F?88:92, 0.38)}
      {/* FOREARM L */}
      {M("biceps", `M${50-SH-9} ${F?92:96} C${50-SH-13} ${F?100:104} ${50-SH-13} ${F?116:120} ${50-SH-11} ${F?128:132} L${50-SH-6} ${F?130:134} L${50-SH-6} ${F?116:120} L${50-SH-5} ${F?92:96} Z`, 0.6)}
      {M("biceps", `M${50+SH+9} ${F?92:96} C${50+SH+13} ${F?100:104} ${50+SH+13} ${F?116:120} ${50+SH+11} ${F?128:132} L${50+SH+6} ${F?130:134} L${50+SH+6} ${F?116:120} L${50+SH+5} ${F?92:96} Z`, 0.6)}
      {/* ABS - 3 pairs, smaller and higher */}
      {[0,1,2].map(r => {
        const y0 = (F?84:88) + r*12;
        return (
          <g key={r}>
            {M("abdomen", `M${50-10} ${y0} L${50-2} ${y0} L${50-2} ${y0+10} L${50-10} ${y0+10} Z`, 0.86-r*0.06)}
            {M("abdomen", `M${50+2} ${y0} L${50+10} ${y0} L${50+10} ${y0+10} L${50+2} ${y0+10} Z`, 0.86-r*0.06)}
          </g>
        );
      })}
      {line(50, F?84:88, 50, F?122:126, 0.5)}
      {[(F?94:98),(F?106:110),(F?118:122)].map(y=>(
        <g key={y}>
          {line(50-10, y, 50-2, y, 0.26)}
          {line(50+2, y, 50+10, y, 0.26)}
        </g>
      ))}
      {/* OBLIQUES */}
      {M("abdomen", `M${50-CW-1} ${F?84:88} C${50-CW-6} ${F?96:100} ${50-CW-5} ${F?116:120} ${50-CW-2} ${F?126:130} L${50-CW+3} ${F?124:128} L${50-CW+2} ${F?100:104} L${50-CW+1} ${F?86:90} Z`, 0.6)}
      {M("abdomen", `M${50+CW+1} ${F?84:88} C${50+CW+6} ${F?96:100} ${50+CW+5} ${F?116:120} ${50+CW+2} ${F?126:130} L${50+CW-3} ${F?124:128} L${50+CW-2} ${F?100:104} L${50+CW-1} ${F?86:90} Z`, 0.6)}
      {/* QUAD L */}
      {M("piernas", `M${50-HW+1} ${F?134:136} C${50-HW-2} ${F?150:152} ${50-HW-2} ${F?180:182} ${50-HW} ${F?198:200} L${50-8} ${F?200:202} L${50-6} ${F?180:182} L${50-7} ${F?136:138} Z`, 0.88)}
      {M("piernas", `M${50-7} ${F?136:138} C${50-4} ${F?150:152} ${50-4} ${F?178:180} ${50-4} ${F?198:200} L${50-1} ${F?200:202} L${50-1} ${F?180:182} L${50-2} ${F?136:138} Z`, 0.72)}
      {M("piernas", `M${50-HW-2} ${F?148:150} C${50-HW-6} ${F?164:166} ${50-HW-5} ${F?186:188} ${50-HW-3} ${F?198:200} L${50-HW+1} ${F?198:200} L${50-HW} ${F?178:180} L${50-HW} ${F?150:152} Z`, 0.7)}
      {M("piernas", `M${50-4} ${F?172:174} C${50-1} ${F?182:184} ${50-1} ${F?196:198} ${50-3} ${F?202:204} L${50-8} ${F?202:204} L${50-8} ${F?194:196} L${50-5} ${F?174:176} Z`, 0.65)}
      {/* QUAD R */}
      {M("piernas", `M${50+HW-1} ${F?134:136} C${50+HW+2} ${F?150:152} ${50+HW+2} ${F?180:182} ${50+HW} ${F?198:200} L${50+8} ${F?200:202} L${50+6} ${F?180:182} L${50+7} ${F?136:138} Z`, 0.88)}
      {M("piernas", `M${50+7} ${F?136:138} C${50+4} ${F?150:152} ${50+4} ${F?178:180} ${50+4} ${F?198:200} L${50+1} ${F?200:202} L${50+1} ${F?180:182} L${50+2} ${F?136:138} Z`, 0.72)}
      {M("piernas", `M${50+HW+2} ${F?148:150} C${50+HW+6} ${F?164:166} ${50+HW+5} ${F?186:188} ${50+HW+3} ${F?198:200} L${50+HW-1} ${F?198:200} L${50+HW} ${F?178:180} L${50+HW} ${F?150:152} Z`, 0.7)}
      {M("piernas", `M${50+4} ${F?172:174} C${50+1} ${F?182:184} ${50+1} ${F?196:198} ${50+3} ${F?202:204} L${50+8} ${F?202:204} L${50+8} ${F?194:196} L${50+5} ${F?174:176} Z`, 0.65)}
      {/* TIBIALIS */}
      {M("piernas", `M${50-HW} ${F?210:212} C${50-HW-2} ${F?228:230} ${50-HW-2} ${F?250:252} ${50-HW} ${F?264:266} L${50-8} ${F?266:268} L${50-7} ${F?250:252} L${50-7} ${F?210:212} Z`, 0.7)}
      {M("piernas", `M${50+HW} ${F?210:212} C${50+HW+2} ${F?228:230} ${50+HW+2} ${F?250:252} ${50+HW} ${F?264:266} L${50+8} ${F?266:268} L${50+7} ${F?250:252} L${50+7} ${F?210:212} Z`, 0.7)}
      {/* CARDIO */}
      {(() => {
        const v=xp("cardio"), c=v>0?getMR(v).color:"#FF4466";
        const y0=F?60:64;
        return <path d={`M${50-2} ${y0-2} C${50-1} ${y0-5} ${50-6} ${y0-5} ${50-6} ${y0} C${50-6} ${y0+5} ${50} ${y0+10} ${50} ${y0+10} C${50} ${y0+10} ${50+6} ${y0+5} ${50+6} ${y0} C${50+6} ${y0-5} ${50+1} ${y0-5} ${50+2} ${y0-2} Z`}
          fill={c+"55"} stroke={c} strokeWidth={v>0?1.3:0.5}
          style={v>0?{filter:`drop-shadow(0 0 5px ${c})`}:{}}/>;
      })()}
    </>
  );

  // ── BACK MUSCLES ─────────────────────────────────────────────────────────
  const back = (
    <>
      {/* TRAPEZIUS diamond */}
      {M("espalda", `M50 ${F?24:28} L${50-SH+2} ${F?36:40} L${50-SH+4} ${F?50:54} L${50-5} ${F?56:60} L50 ${F?58:62} L${50+5} ${F?56:60} L${50+SH-4} ${F?50:54} L${50+SH-2} ${F?36:40} Z`, 0.82)}
      {/* DELTOID REAR L */}
      {M("hombros", `M${50-SH+2} ${F?36:40} C${50-SH-6} ${F?42:46} ${50-SH-8} ${F?56:60} ${50-SH-6} ${F?68:72} L${50-SH-2} ${F?68:72} L${50-SH+1} ${F?54:58} L${50-SH+3} ${F?38:42} Z`, 0.82)}
      {/* DELTOID REAR R */}
      {M("hombros", `M${50+SH-2} ${F?36:40} C${50+SH+6} ${F?42:46} ${50+SH+8} ${F?56:60} ${50+SH+6} ${F?68:72} L${50+SH+2} ${F?68:72} L${50+SH-1} ${F?54:58} L${50+SH-3} ${F?38:42} Z`, 0.82)}
      {/* LAT L — V taper */}
      {M("espalda", `M${50-SH+2} ${F?56:60} C${50-SH-6} ${F?70:74} ${50-SH-7} ${F?96:100} ${50-SH-5} ${F?118:122} L${50-WW} ${F?128:132} L${50-WW+4} ${F?124:128} L${50-CW} ${F?100:104} L${50-SH} ${F?64:68} Z`, 0.88)}
      {/* LAT R */}
      {M("espalda", `M${50+SH-2} ${F?56:60} C${50+SH+6} ${F?70:74} ${50+SH+7} ${F?96:100} ${50+SH+5} ${F?118:122} L${50+WW} ${F?128:132} L${50+WW-4} ${F?124:128} L${50+CW} ${F?100:104} L${50+SH} ${F?64:68} Z`, 0.88)}
      {/* SPINE */}
      {line(50, F?26:30, 50, F?132:136, 0.45)}
      {[F?38:42,F?50:54,F?62:66,F?74:78,F?86:90,F?98:102,F?110:114,F?122:126].map(y=>(
        <ellipse key={y} cx="50" cy={y} rx="2" ry="1.5" fill="#0BF4FF0A" stroke={N} strokeWidth="0.35" opacity="0.28"/>
      ))}
      {/* TRICEP L */}
      {M("triceps", `M${50-SH-1} ${F?54:58} C${50-SH-8} ${F?64:68} ${50-SH-9} ${F?80:84} ${50-SH-7} ${F?94:98} L${50-SH-3} ${F?94:98} L${50-SH-1} ${F?80:84} L${50-SH+1} ${F?56:60} Z`, 0.85)}
      {/* TRICEP R */}
      {M("triceps", `M${50+SH+1} ${F?54:58} C${50+SH+8} ${F?64:68} ${50+SH+9} ${F?80:84} ${50+SH+7} ${F?94:98} L${50+SH+3} ${F?94:98} L${50+SH+1} ${F?80:84} L${50+SH-1} ${F?56:60} Z`, 0.85)}
      {/* GLUTE L */}
      {M("gluteos", `M${50-HW} ${F?134:132} C${50-HW-4} ${F?148:146} ${50-HW-3} ${F?166:164} ${50-2} ${F?178:176} L50 ${F?178:176} L50 ${F?134:132} Z`, 0.88)}
      {/* GLUTE R */}
      {M("gluteos", `M${50+HW} ${F?134:132} C${50+HW+4} ${F?148:146} ${50+HW+3} ${F?166:164} ${50+2} ${F?178:176} L50 ${F?178:176} L50 ${F?134:132} Z`, 0.88)}
      {line(50, F?134:132, 50, F?178:176, 0.45)}
      {/* HAMSTRING L */}
      {M("piernas", `M${50-HW} ${F?180:178} C${50-HW-3} ${F?194:192} ${50-HW-2} ${F?216:214} ${50-HW} ${F?232:230} L${50-6} ${F?232:230} L${50-5} ${F?214:212} L${50-6} ${F?180:178} Z`, 0.85)}
      {/* HAMSTRING R */}
      {M("piernas", `M${50+HW} ${F?180:178} C${50+HW+3} ${F?194:192} ${50+HW+2} ${F?216:214} ${50+HW} ${F?232:230} L${50+6} ${F?232:230} L${50+5} ${F?214:212} L${50+6} ${F?180:178} Z`, 0.85)}
      {/* GASTROCNEMIUS L */}
      {M("piernas", `M${50-HW-1} ${F?238:236} C${50-HW-4} ${F?254:252} ${50-HW-3} ${F?272:270} ${50-HW-1} ${F?284:282} L${50-6} ${F?284:282} L${50-5} ${F?270:268} L${50-5} ${F?238:236} Z`, 0.84)}
      {/* GASTROCNEMIUS R */}
      {M("piernas", `M${50+HW+1} ${F?238:236} C${50+HW+4} ${F?254:252} ${50+HW+3} ${F?272:270} ${50+HW+1} ${F?284:282} L${50+6} ${F?284:282} L${50+5} ${F?270:268} L${50+5} ${F?238:236} Z`, 0.84)}
      {/* ACHILLES */}
      {line(50-HW+1, F?284:282, 50-HW+1, F?294:292, 0.4)}
      {line(50+HW-1, F?284:282, 50+HW-1, F?294:292, 0.4)}
    </>
  );

  return (
    <svg viewBox="0 0 100 318" style={{width:"100%",maxWidth:180,filter:"drop-shadow(0 0 16px #0BF4FF12)",background:"transparent"}}>
      {skeleton}
      {view==="front" ? front : back}
      <text x="50" y="312" textAnchor="middle" fill={N} fontSize="5" opacity="0.28" fontFamily="Rajdhani,sans-serif" letterSpacing="4">
        {view==="front"?"FRONTAL":"POSTERIOR"}
      </text>
    </svg>
  );
}

function MiniChart({data,color}){
  const ref=useRef();
  useEffect(()=>{
    const ctx=ref.current?.getContext("2d");if(!ctx)return;
    const w=ref.current.width,h=ref.current.height,vals=data.map(d=>d.kg),mn=Math.min(...vals)*.95,mx=Math.max(...vals)*1.05;
    ctx.clearRect(0,0,w,h);ctx.strokeStyle=color;ctx.lineWidth=2;
    ctx.beginPath();data.forEach((d,i)=>{const x=(i/(data.length-1))*w,y=h-((d.kg-mn)/(mx-mn||1))*(h-10)-5;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.stroke();
    data.forEach((d,i)=>{const x=(i/(data.length-1))*w,y=h-((d.kg-mn)/(mx-mn||1))*(h-10)-5;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();});
  },[data,color]);
  return <div style={{marginTop:12,padding:12,background:"#080810",borderRadius:10,border:`1px solid ${color}22`}}><div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:8}}>PROGRESIÓN DE PESO</div><canvas ref={ref} width={260} height={100} style={{width:"100%",height:80}}/></div>;
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function ProgramasTab({userList, flash}){
  const getCustomPrograms=()=>{try{return JSON.parse(localStorage.getItem("rku_admin_programs")||"[]");}catch{return[];}};
  const saveCustomPrograms=p=>{localStorage.setItem("rku_admin_programs",JSON.stringify(p));fbSet("adminPrograms",p).catch(()=>{});};
  const [programs,setPrograms]=useState(()=>getCustomPrograms());
  const saveProgs=p=>{setPrograms(p);saveCustomPrograms(p);};

  useEffect(()=>{
    fbGet("adminPrograms").then(p=>{if(p&&p.length>0){localStorage.setItem("rku_admin_programs",JSON.stringify(p));setPrograms(p);}}).catch(()=>{});
  },[]);
  const allPrograms=[...PROGRAM_TEMPLATES,...programs];
  const [editProg,setEditProg]=useState(null);
  const [editPhaseIdx,setEditPhaseIdx]=useState(null);
  const [editDayIdx,setEditDayIdx]=useState(null);
  const [newExRow,setNewExRow]=useState({name:"",sets:"3x10",rest:"60s",xp:40,notes:"",muscle:[]});
  const [view,setView]=useState("list");

          const duplicateProgram=(tpl)=>{
            const copy={
              ...JSON.parse(JSON.stringify(tpl)),
              id:`prog_${Date.now()}`,
              name:`${tpl.name} (copia)`,
              isCustom:true,
              createdAt:Date.now()
            };
            saveProgs([...programs,copy]);
            flash(`✅ "${tpl.name}" duplicado`);
          };

          const deleteProgram=(id)=>{
            saveProgs(programs.filter(p=>p.id!==id));
            flash("🗑️ Programa eliminado");
          };

          const inp2={width:"100%",padding:"10px 12px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:8,boxSizing:"border-box"};

          if(view==="editDay"&&editProg&&editPhaseIdx!==null&&editDayIdx!==null){
            const phase=editProg.phases[editPhaseIdx];
            const day=phase.training[editDayIdx];
            return(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                  <button onClick={()=>setView("editPhase")} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#E8C547",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
                  <div style={{fontSize:12,color:"#FFF",fontWeight:700,fontFamily:"'Rajdhani',sans-serif",flex:1}}>{day.day}</div>
                </div>
                {/* Day name edit */}
                <div style={{background:"#0D0D1A",borderRadius:10,padding:12,border:"1px solid #2A2A44",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:6}}>NOMBRE DEL DÍA</div>
                  <input style={inp2} value={day.day} onChange={e=>{
                    const p=JSON.parse(JSON.stringify(editProg));
                    p.phases[editPhaseIdx].training[editDayIdx].day=e.target.value;
                    setEditProg(p);
                  }}/>
                </div>
                {/* Exercises */}
                <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:10}}>EJERCICIOS ({day.exercises.length})</div>
                {day.exercises.map((ex,ei)=>(
                  <div key={ei} style={{background:"#0F0F1C",border:"1px solid #1E1E32",borderRadius:9,padding:12,marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",flex:1}}>{ex.name}</div>
                      <button onClick={()=>{
                        const p=JSON.parse(JSON.stringify(editProg));
                        p.phases[editPhaseIdx].training[editDayIdx].exercises.splice(ei,1);
                        setEditProg(p);
                      }} style={{background:"none",border:"none",color:"#E84A5F",cursor:"pointer",fontSize:14,padding:"0 4px"}}>✕</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 60px",gap:6}}>
                      <input value={ex.sets} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].training[editDayIdx].exercises[ei].sets=e.target.value;setEditProg(p);}}
                        style={{...inp2,marginBottom:0,fontSize:11}} placeholder="Series"/>
                      <input value={ex.rest} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].training[editDayIdx].exercises[ei].rest=e.target.value;setEditProg(p);}}
                        style={{...inp2,marginBottom:0,fontSize:11}} placeholder="Descanso"/>
                      <input type="number" value={ex.xp} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].training[editDayIdx].exercises[ei].xp=parseInt(e.target.value)||0;setEditProg(p);}}
                        style={{...inp2,marginBottom:0,fontSize:11}} placeholder="XP"/>
                    </div>
                    {ex.notes!==undefined&&<input value={ex.notes||""} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].training[editDayIdx].exercises[ei].notes=e.target.value;setEditProg(p);}}
                      style={{...inp2,marginBottom:0,marginTop:6,fontSize:11}} placeholder="Notas (opcional)"/>}
                    <label style={{display:"flex",alignItems:"center",gap:6,marginTop:6,cursor:"pointer"}}>
                      <input type="checkbox" checked={!!ex.boss} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].training[editDayIdx].exercises[ei].boss=e.target.checked;setEditProg(p);}}/>
                      <span style={{fontSize:11,color:"#F59E0B"}}>⚡ Boss exercise</span>
                    </label>
                  </div>
                ))}
                {/* Add exercise */}
                <div style={{background:"#0D0D1A",border:"1px solid #E8C54733",borderRadius:10,padding:12,marginTop:8,marginBottom:12}}>
                  <div style={{fontSize:9,color:"#E8C547",letterSpacing:3,marginBottom:8}}>+ AÑADIR EJERCICIO</div>
                  {/* Exercise search from DB */}
                  <select style={{...inp2,marginBottom:6,color:"#AAA"}} onChange={e=>{
                    if(!e.target.value) return;
                    const ex=EXERCISE_DB.find(x=>x.name===e.target.value);
                    if(ex) setNewExRow(p=>({...p,name:ex.name,xp:ex.xpBase,muscle:ex.muscle}));
                  }}>
                    <option value="">📚 Buscar en base de ejercicios...</option>
                    {Object.keys(MUSCLE_DEFS).map(m=>(
                      <optgroup key={m} label={MUSCLE_DEFS[m].label}>
                        {EXERCISE_DB.filter(e=>e.muscle.includes(m)).map(e=>(
                          <option key={e.id} value={e.name}>{e.name} ({e.xpBase}XP)</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <input style={inp2} placeholder="Nombre del ejercicio..." value={newExRow.name} onChange={e=>setNewExRow(p=>({...p,name:e.target.value}))}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 60px",gap:6,marginBottom:6}}>
                    <input style={{...inp2,marginBottom:0,fontSize:11}} placeholder="Series" value={newExRow.sets} onChange={e=>setNewExRow(p=>({...p,sets:e.target.value}))}/>
                    <input style={{...inp2,marginBottom:0,fontSize:11}} placeholder="Descanso" value={newExRow.rest} onChange={e=>setNewExRow(p=>({...p,rest:e.target.value}))}/>
                    <input type="number" style={{...inp2,marginBottom:0,fontSize:11}} placeholder="XP" value={newExRow.xp} onChange={e=>setNewExRow(p=>({...p,xp:parseInt(e.target.value)||40}))}/>
                  </div>
                  {newExRow.name&&<div style={{fontSize:10,color:"#555",marginBottom:6}}>
                    💪 {(newExRow.muscle||[]).map(m=>MUSCLE_DEFS[m]?.label||m).join(", ")||"Sin grupo asignado"}
                  </div>}
                  <button onClick={()=>{
                    if(!newExRow.name.trim()) return;
                    const p=JSON.parse(JSON.stringify(editProg));
                    p.phases[editPhaseIdx].training[editDayIdx].exercises.push({name:newExRow.name.trim(),sets:newExRow.sets||"3x10",rest:newExRow.rest||"60s",xp:newExRow.xp||40,muscle:newExRow.muscle||[],boss:false,notes:""});
                    setEditProg(p);
                    setNewExRow({name:"",sets:"3x10",rest:"60s",xp:40,notes:"",muscle:[]});
                  }} style={{width:"100%",padding:9,background:"#E8C54722",border:"1px solid #E8C54744",borderRadius:8,color:"#E8C547",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>✚ AÑADIR</button>
                </div>
                <button onClick={()=>{
                  const updated=programs.map(p=>p.id===editProg.id?editProg:p);
                  saveProgs(updated);
                  flash("✅ Día guardado");
                  setView("editPhase");
                }} style={{width:"100%",padding:13,background:"linear-gradient(135deg,#E8C547,#B8952A)",border:"none",borderRadius:10,color:"#07070F",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>💾 GUARDAR DÍA</button>
              </div>
            );
          }

          if(view==="editPhase"&&editProg&&editPhaseIdx!==null){
            const phase=editProg.phases[editPhaseIdx];
            return(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                  <button onClick={()=>setView("editProg")} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#E8C547",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
                  <div style={{fontSize:12,color:"#FFF",fontWeight:700,fontFamily:"'Rajdhani',sans-serif",flex:1}}>{phase.name}: {phase.subtitle}</div>
                </div>
                <div style={{background:"#0D0D1A",borderRadius:10,padding:12,border:"1px solid #1E1E32",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:8}}>NOMBRE DE FASE</div>
                  <input style={inp2} value={phase.subtitle} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].subtitle=e.target.value;setEditProg(p);}}/>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:6,marginTop:4}}>DUNGEON</div>
                  <input style={inp2} value={phase.dungeonName} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].dungeonName=e.target.value;setEditProg(p);}}/>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:6,marginTop:4}}>SEMANAS</div>
                  <input style={inp2} value={phase.weeks} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].weeks=e.target.value;setEditProg(p);}}/>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:6,marginTop:4}}>OBJETIVO</div>
                  <input style={inp2} value={phase.goal} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].goal=e.target.value;setEditProg(p);}}/>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:6,marginTop:4}}>MANTRA</div>
                  <input style={inp2} value={phase.mantra} onChange={e=>{const p=JSON.parse(JSON.stringify(editProg));p.phases[editPhaseIdx].mantra=e.target.value;setEditProg(p);}}/>
                </div>
                <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:10}}>SESIONES ({phase.training.length})</div>
                {phase.training.map((day,di)=>{
                  const exCount=day.exercises.length;
                  return(
                    <div key={di} onClick={()=>{setEditDayIdx(di);setView("editDay");}}
                      style={{background:"#0F0F1C",border:"1px solid #1E1E32",borderRadius:9,padding:"12px 14px",marginBottom:6,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:9,color:"#555",letterSpacing:2,marginBottom:2}}>SESIÓN {di+1}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{day.day}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:10,color:"#555"}}>{exCount} ejercicios</span>
                        <span style={{color:"#E8C547",fontSize:14}}>›</span>
                      </div>
                    </div>
                  );
                })}
                <button onClick={()=>{
                  const p=JSON.parse(JSON.stringify(editProg));
                  const wk=Math.max(...phase.training.map(d=>d.week||1));
                  p.phases[editPhaseIdx].training.push({day:`Sesión ${phase.training.length+1}`,week:wk,exercises:[]});
                  setEditProg(p);
                }} style={{width:"100%",padding:10,background:"transparent",border:"1px dashed #E8C54744",borderRadius:9,color:"#E8C547",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",marginTop:8,marginBottom:12}}>+ AÑADIR SESIÓN</button>
                <button onClick={()=>{
                  const updated=programs.map(p=>p.id===editProg.id?editProg:p);
                  saveProgs(updated);
                  flash("✅ Fase guardada");
                  setView("editProg");
                }} style={{width:"100%",padding:13,background:"linear-gradient(135deg,#E8C547,#B8952A)",border:"none",borderRadius:10,color:"#07070F",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>💾 GUARDAR FASE</button>
              </div>
            );
          }

          if(view==="editProg"&&editProg){
            return(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                  <button onClick={()=>{setView("list");setEditProg(null);}} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#E8C547",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
                  <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif",flex:1}}>EDITANDO PROGRAMA</div>
                </div>
                <div style={{background:"#0D0D1A",borderRadius:10,padding:12,border:"1px solid #1E1E32",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:6}}>NOMBRE DEL PROGRAMA</div>
                  <input style={inp2} value={editProg.name} onChange={e=>{setEditProg({...editProg,name:e.target.value});}}/>
                  <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:6,marginTop:4}}>DESCRIPCIÓN</div>
                  <input style={inp2} value={editProg.desc||""} onChange={e=>{setEditProg({...editProg,desc:e.target.value});}}/>
                </div>
                <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:10}}>FASES ({editProg.phases.length})</div>
                {editProg.phases.map((ph,pi)=>{
                  const sessions=ph.training.length;
                  const exTotal=ph.training.reduce((a,d)=>a+d.exercises.length,0);
                  return(
                    <div key={pi} onClick={()=>{setEditPhaseIdx(pi);setView("editPhase");}}
                      style={{background:"#0F0F1C",border:`1px solid ${ph.color}33`,borderRadius:10,padding:14,marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:9,color:ph.color,letterSpacing:3,marginBottom:2}}>{ph.name}</div>
                        <div style={{fontSize:14,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{ph.subtitle}</div>
                        <div style={{fontSize:10,color:"#555",marginTop:2}}>{sessions} sesiones · {exTotal} ejercicios</div>
                      </div>
                      <span style={{color:ph.color,fontSize:18}}>›</span>
                    </div>
                  );
                })}
                <button onClick={()=>{
                  const updated=programs.map(p=>p.id===editProg.id?editProg:p);
                  saveProgs(updated);
                  flash("✅ Programa guardado");
                  setView("list");
                  setEditProg(null);
                }} style={{width:"100%",padding:13,marginTop:8,background:"linear-gradient(135deg,#E8C547,#B8952A)",border:"none",borderRadius:10,color:"#07070F",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>💾 GUARDAR PROGRAMA</button>
              </div>
            );
          }

          // LIST view
          return(
            <div>
              <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:14}}>PLANTILLAS DE PROGRAMA ({allPrograms.length})</div>
              {allPrograms.map(tpl=>{
                const isBuiltin=PROGRAM_TEMPLATES.some(t=>t.id===tpl.id);
                const assignedTo=userList.filter(u=>{const d=getUserData(u.email)||defaultData();return d.assignedProgram?.id===tpl.id;});
                const c=tpl.color||"#E8C547";
                return(
                  <div key={tpl.id} style={{background:"#0F0F1C",border:`1px solid ${c}33`,borderRadius:12,padding:14,marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                      <span style={{fontSize:22}}>{tpl.icon||"⚔️"}</span>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{fontSize:15,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{tpl.name}</div>
                          {isBuiltin&&<span style={{fontSize:9,padding:"2px 6px",background:"#A78BFA22",border:"1px solid #A78BFA44",borderRadius:10,color:"#A78BFA"}}>PLANTILLA</span>}
                        </div>
                        <div style={{fontSize:10,color:"#555",marginTop:1}}>{tpl.phases?.length||0} fases · {tpl.phases?.reduce((a,p)=>a+p.training.length,0)||0} sesiones</div>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:"#555",marginBottom:10}}>{tpl.desc}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                      <button onClick={()=>duplicateProgram(tpl)} style={{padding:"6px 12px",background:"#60A5FA18",border:"1px solid #60A5FA44",borderRadius:7,color:"#60A5FA",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>📋 DUPLICAR</button>
                      {!isBuiltin&&<button onClick={()=>{setEditProg(JSON.parse(JSON.stringify(tpl)));setView("editProg");}} style={{padding:"6px 12px",background:`${c}18`,border:`1px solid ${c}44`,borderRadius:7,color:c,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>✏️ EDITAR</button>}
                      {!isBuiltin&&<button onClick={()=>deleteProgram(tpl.id)} style={{padding:"6px 12px",background:"#E84A5F18",border:"1px solid #E84A5F44",borderRadius:7,color:"#E84A5F",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>🗑 ELIMINAR</button>}
                    </div>
                    {assignedTo.length>0&&(
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:9,color:"#444",letterSpacing:2}}>ASIGNADO A:</span>
                        {assignedTo.map(u=>(
                          <span key={u.email} style={{fontSize:10,padding:"2px 8px",background:`${c}18`,border:`1px solid ${c}33`,borderRadius:20,color:c}}>{u.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
}

function AdminUserPhoto({email, rank}){
  const [photo,setPhoto]=useState(null);
  useEffect(()=>{
    // Always try Firebase first
    const key=email.replace(/\./g,"_").replace(/@/g,"_at_");
    fbGet(`photos/${key}`).then(p=>{
      if(p) setPhoto(p);
      else {
        // fallback to localStorage
        const local=localStorage.getItem(`rku_photo_${email}`);
        if(local) setPhoto(local);
      }
    }).catch(()=>{
      const local=localStorage.getItem(`rku_photo_${email}`);
      if(local) setPhoto(local);
    });
  },[email]);
  return photo
    ?<img src={photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
    :<span>{rank}</span>;
}

function AdminPanel({onLogout}){
  const [tab,setTab]=useState("usuarios");
  const [selUser,setSelUser]=useState(null);
  const [editData,setEditData]=useState(null);
  // Helper: get user data preferring Firebase cache over localStorage
  const [msg,setMsg]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);
  const [newPw,setNewPw]=useState("");
  const [showNewUserForm,setShowNewUserForm]=useState(false);
  const [nuName,setNuName]=useState("");
  const [nuEmail,setNuEmail]=useState("");
  const [nuPass,setNuPass]=useState("");
  const [nuIsTest,setNuIsTest]=useState(false);
  const [showNewPw,setShowNewPw]=useState(false);

  const [allUsers,setAllUsers]=useState(getUsers());
  const userList=Object.entries(allUsers).map(([email,u])=>({email,...u}));
  const realUserList=userList.filter(u=>!u.isTest); // exclude test users from stats

  const flash=(m,ok=true)=>{setMsg({text:m,ok});setTimeout(()=>setMsg(""),3000);};

  const createNewUser=()=>{
    if(!nuName.trim()||!nuEmail.trim()||nuPass.length<6){flash("Rellena todos los campos (contrasena min. 6 caracteres)",false);return;}
    const email=nuEmail.trim().toLowerCase();
    const users=getUsers();
    if(users[email]){flash("Ya existe un usuario con ese email",false);return;}
    users[email]={name:nuName.trim(),email,password:hashPw(nuPass),createdAt:Date.now(),isTest:nuIsTest};
    saveUsers(users);
    saveUserData(email,defaultData());
    setAllUsers({...users});
    setNuName("");setNuEmail("");setNuPass("");setNuIsTest(false);
    setShowNewUserForm(false);
    flash("Usuario "+nuName.trim()+" creado");
  };

  const openUser=(email)=>{
    const data=getUD(email)||defaultData();
    setSelUser(email);
    setEditData(JSON.parse(JSON.stringify(data)));
    setNewPw("");
    loadUserMessages(email);
    markAdminRead(email);
  };

  const saveEdit=()=>{
    saveUserData(selUser,editData);
    setAllUserData(p=>({...p,[selUser]:editData}));
    if(newPw.trim().length>=6){
      const users=getUsers();
      users[selUser].password=hashPw(newPw.trim());
      saveUsers(users);
    }
    flash("✅ Cambios guardados");
    setSelUser(null);setEditData(null);
  };

  const deleteUser=(email)=>{
    // Remove from localStorage
    const users=getUsers();
    delete users[email];
    localStorage.setItem("rku_users", JSON.stringify(users));
    localStorage.removeItem(`rku_data_${email}`);
    // Remove from Firebase
    const safeKey=email.replace(/\./g,"_").replace(/@/g,"_at_");
    fbSet(`users/${safeKey}`,null).catch(()=>{});
    fbSet(`userData/${safeKey}`,null).catch(()=>{});
    fbSet(`photos/${safeKey}`,null).catch(()=>{});
    // Update local state
    setAllUsers(prev=>{const n={...prev};delete n[email];return n;});
    setConfirmDel(null);
    setSelUser(null);
    setEditData(null);
    flash("🗑️ Usuario eliminado");
  };

  const resetProgress=(email)=>{
    saveUserData(email,defaultData());
    if(selUser===email) setEditData(defaultData());
    flash("🔄 Progreso reiniciado");
  };

  const addCoinsAdmin=(email,amt)=>{
    const base=(selUser===email&&editData)?{...editData}:(getUD(email)||defaultData());
    base.coins=(base.coins||0)+amt;
    saveUserData(email,base);
    if(selUser===email) setEditData({...base});
    flash(`🪙 +${amt} monedas añadidas`);
  };

  const addXpAdmin=(email,amt)=>{
    const base=(selUser===email&&editData)?{...editData}:(getUD(email)||defaultData());
    base.totalXp=(base.totalXp||0)+amt;
    saveUserData(email,base);
    if(selUser===email) setEditData({...base});
    flash(`⚡ +${amt} XP añadidos`);
  };

  const TABS_ADMIN=[{id:"usuarios",l:"👥 Usuarios"},{id:"rutinas",l:"🛠️ Rutinas"},{id:"dietas",l:"🥗 Dietas"},{id:"programas",l:"📋 Programas"},{id:"stats",l:"📊 Stats"},{id:"ranking",l:"🏅 Ranking"}];

  // ── Admin routines state ──
  const getAdminRoutines=()=>{try{return JSON.parse(localStorage.getItem("rku_admin_routines")||"[]");}catch{return[];}};
  const saveAdminRoutines=r=>{localStorage.setItem("rku_admin_routines",JSON.stringify(r));fbSet("adminRoutines",r).catch(()=>{});};
  const [adminRoutines,setAdminRoutinesState]=useState(getAdminRoutines());
  const saveAR=r=>{setAdminRoutinesState(r);saveAdminRoutines(r);};

  // Cache of all user data loaded from Firebase — keyed by email
  const [allUserData,setAllUserData]=useState({});
  const [dataLoading,setDataLoading]=useState(true);
  const getUD=(email)=>allUserData[email]||getUserData(email)||defaultData();
  const [userMessages,setUserMessages]=useState({});  // {email: [msgs]}
  const [adminMsgInput,setAdminMsgInput]=useState("");

  const loadUserMessages=async(email)=>{
    const msgKey=email.replace(/\./g,"_").replace(/@/g,"_at_");
    const msgs=await fbGet(`messages/${msgKey}`).catch(()=>null);
    const arr=msgs?(Array.isArray(msgs)?msgs:Object.values(msgs)):[];
    setUserMessages(p=>({...p,[email]:arr}));
    return arr;
  };

  const sendAdminMessage=async(email,text)=>{
    if(!text.trim()) return;
    const msgKey=email.replace(/\./g,"_").replace(/@/g,"_at_");
    const existing=userMessages[email]||[];
    const msg={id:Date.now(),from:"admin",text:text.trim(),date:new Date().toISOString(),read:false};
    const updated=[...existing,msg];
    setUserMessages(p=>({...p,[email]:updated}));
    await fbSet(`messages/${msgKey}`,updated).catch(()=>{});
    setAdminMsgInput("");
    flash("✅ Mensaje enviado");
  };

  const markAdminRead=async(email)=>{
    const msgKey=email.replace(/\./g,"_").replace(/@/g,"_at_");
    const msgs=(userMessages[email]||[]).map(m=>m.from==="user"?{...m,read:true}:m);
    setUserMessages(p=>({...p,[email]:msgs}));
    await fbSet(`messages/${msgKey}`,msgs).catch(()=>{});
  };

  // Sync admin routines, diets and ALL user data from Firebase on mount
  useEffect(()=>{
    fbGet("adminRoutines").then(r=>{if(r&&r.length>0){localStorage.setItem("rku_admin_routines",JSON.stringify(r));setAdminRoutinesState(r);}}).catch(()=>{});
    fbGet("adminDiets").then(d=>{if(d&&d.length>0){localStorage.setItem("rku_admin_diets",JSON.stringify(d));setAdminDietsState(d);}}).catch(()=>{});
    syncUsersFromFirebase().then(u=>{
      if(u) setAllUsers(u);
      // Load each user's data from Firebase
      const emails=Object.keys(u||{});
      Promise.all(emails.map(email=>{
        const key=email.replace(/\./g,"_").replace(/@/g,"_at_");
        return fbGet(`userData/${key}`).then(d=>({email,data:d||defaultData()})).catch(()=>({email,data:getUD(email)||defaultData()}));
      })).then(results=>{
        const map={};
        results.forEach(({email,data})=>{
          map[email]=data;
          // Also cache in localStorage so getUserData() works as fallback
          localStorage.setItem(`rku_data_${email}`,JSON.stringify(data));
        });
        setAllUserData(map);
        setDataLoading(false);
      });
    }).catch(()=>setDataLoading(false));
  },[]);

  const [showRoutineBuilder,setShowRoutineBuilder]=useState(false);
  const [editingRoutine,setEditingRoutine]=useState(null);
  const [rtName,setRtName]=useState("");
  const [rtColor,setRtColor]=useState("#A78BFA");
  const [rtSessions,setRtSessions]=useState([{day:"Día 1",exercises:[]}]);
  const [rtExInput,setRtExInput]=useState({});
  const [assignModal,setAssignModal]=useState(null); // {routineId}

  const openNewRoutine=()=>{setEditingRoutine(null);setRtName("");setRtColor("#A78BFA");setRtSessions([{day:"Día 1",exercises:[]}]);setShowRoutineBuilder(true);};
  const openEditRoutine=rt=>{setEditingRoutine(rt.id);setRtName(rt.name);setRtColor(rt.color||"#A78BFA");setRtSessions(JSON.parse(JSON.stringify(rt.sessions)));setShowRoutineBuilder(true);};

  const saveRoutine=()=>{
    if(!rtName.trim()) return;
    const rt={id:editingRoutine||Date.now(),name:rtName.trim(),color:rtColor,sessions:rtSessions,createdAt:editingRoutine?(adminRoutines.find(r=>r.id===editingRoutine)?.createdAt||Date.now()):Date.now()};
    const updated=editingRoutine?adminRoutines.map(r=>r.id===editingRoutine?rt:r):[...adminRoutines,rt];
    saveAR(updated);setShowRoutineBuilder(false);flash("✅ Rutina guardada");
  };

  const deleteAdminRoutine=id=>{saveAR(adminRoutines.filter(r=>r.id!==id));flash("🗑️ Rutina eliminada");};

  const assignRoutineToUser=(email,routine)=>{
    const data=getUD(email)||defaultData();
    const exists=(data.customRoutines||[]).find(r=>r.id===routine.id);
    if(exists){flash("⚠️ El jugador ya tiene esta rutina",false);return;}
    data.customRoutines=[...(data.customRoutines||[]),{...routine,assignedByAdmin:true}];
    saveUserData(email,data);
    if(selUser===email) setEditData({...editData,customRoutines:data.customRoutines});
    flash(`✅ Rutina asignada a ${allUsers[email]?.name}`);
    setAssignModal(null);
  };

  const removeRoutineFromUser=(email,routineId)=>{
    const data=getUD(email)||defaultData();
    data.customRoutines=(data.customRoutines||[]).filter(r=>r.id!==routineId);
    saveUserData(email,data);
    setEditData({...editData,customRoutines:data.customRoutines});
    flash("🗑️ Rutina eliminada del jugador");
  };

  const COLORS=["#A78BFA","#60A5FA","#34D399","#F87171","#FBBF24","#F59E0B","#E879F9","#0AF5FF"];

  // ── Admin diets state ──────────────────────────────────────────────────────
  const getAdminDiets=()=>{try{return JSON.parse(localStorage.getItem("rku_admin_diets")||"[]");}catch{return[];}};
  const saveAdminDiets=d=>{localStorage.setItem("rku_admin_diets",JSON.stringify(d));fbSet("adminDiets",d).catch(()=>{});};
  const [adminDiets,setAdminDietsState]=useState(getAdminDiets());
  const saveAD=d=>{setAdminDietsState(d);saveAdminDiets(d);};

  const [showDietBuilder,setShowDietBuilder]=useState(false);
  const [editingDiet,setEditingDiet]=useState(null);
  const [dtName,setDtName]=useState("");
  const [dtColor,setDtColor]=useState("#34D399");
  const [dtCalories,setDtCalories]=useState("");
  const [dtProtein,setDtProtein]=useState("");
  const [dtGoal,setDtGoal]=useState("");
  const [dtMeals,setDtMeals]=useState([{time:"8:00",name:"Desayuno",desc:""}]);
  const [dtTips,setDtTips]=useState([""]);
  const [assignDietModal,setAssignDietModal]=useState(null);

  const openNewDiet=()=>{setEditingDiet(null);setDtName("");setDtColor("#34D399");setDtCalories("");setDtProtein("");setDtGoal("");setDtMeals([{time:"8:00",name:"Desayuno",desc:""}]);setDtTips([""]);setShowDietBuilder(true);};
  const openEditDiet=dt=>{setEditingDiet(dt.id);setDtName(dt.name);setDtColor(dt.color||"#34D399");setDtCalories(dt.calories||"");setDtProtein(dt.protein||"");setDtGoal(dt.goal||"");setDtMeals(JSON.parse(JSON.stringify(dt.meals)));setDtTips([...(dt.tips||[]),""].slice(0,10));setShowDietBuilder(true);};

  const saveDiet=()=>{
    if(!dtName.trim()) return;
    const dt={id:editingDiet||Date.now(),name:dtName.trim(),color:dtColor,calories:dtCalories,protein:dtProtein,goal:dtGoal,meals:dtMeals.filter(m=>m.name.trim()),tips:dtTips.filter(t=>t.trim()),createdAt:editingDiet?(adminDiets.find(d=>d.id===editingDiet)?.createdAt||Date.now()):Date.now()};
    const updated=editingDiet?adminDiets.map(d=>d.id===editingDiet?dt:d):[...adminDiets,dt];
    saveAD(updated);setShowDietBuilder(false);flash("✅ Dieta guardada");
  };

  const deleteAdminDiet=id=>{saveAD(adminDiets.filter(d=>d.id!==id));flash("🗑️ Dieta eliminada");};

  const assignDietToUser=(email,diet)=>{
    const data=getUD(email)||defaultData();
    const exists=(data.assignedDiets||[]).find(d=>d.id===diet.id);
    if(exists){flash("⚠️ El jugador ya tiene esta dieta",false);return;}
    data.assignedDiets=[...(data.assignedDiets||[]),{...diet,assignedByAdmin:true}];
    saveUserData(email,data);
    if(selUser===email) setEditData({...editData,assignedDiets:data.assignedDiets});
    flash(`✅ Dieta asignada a ${allUsers[email]?.name}`);
    setAssignDietModal(null);
  };

  const removeDietFromUser=(email,dietId)=>{
    const data=getUD(email)||defaultData();
    data.assignedDiets=(data.assignedDiets||[]).filter(d=>d.id!==dietId);
    saveUserData(email,data);
    setEditData({...editData,assignedDiets:data.assignedDiets});
    flash("🗑️ Dieta eliminada del jugador");
  };

  const totalUsers=userList.length;
  const totalXpAll=userList.reduce((a,u)=>{const d=getUD(u.email)||defaultData();return a+(d.totalXp||0);},0);
  const totalCoinsAll=userList.reduce((a,u)=>{const d=getUD(u.email)||defaultData();return a+(d.coins||0);},0);

  const inp={width:"100%",padding:"10px 12px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:8,boxSizing:"border-box"};

  // User detail modal
  if(selUser&&editData){
    const uInfo=allUsers[selUser];
    const level=getLevel(editData.totalXp||0);
    const ri=getRank(level);
    const totalDone=Object.values(editData.checked||{}).filter(Boolean).length;
    return(
      <div style={{minHeight:"100dvh",background:"#07070F",color:"#E8E6FF",fontFamily:"'Rajdhani','Segoe UI',sans-serif",padding:"0 0 40px"}}>
        <style>{CSS}</style>
        {/* Header */}
        <div style={{background:"linear-gradient(180deg,#0D0D1F,#07070F)",padding:"14px 16px",borderBottom:"1px solid #A78BFA33",display:"flex",alignItems:"center",gap:14,position:"sticky",top:0,zIndex:100}}>
          <button onClick={()=>{setSelUser(null);setEditData(null);}} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#A78BFA",padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",flexShrink:0}}>← VOLVER</button>
          <div style={{width:80,height:80,borderRadius:18,border:`2px solid ${ri.color}`,background:`${ri.color}22`,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:ri.color,fontFamily:"'Cinzel',serif",boxShadow:`0 0 20px ${ri.color}44`}}>
            <AdminUserPhoto email={selUser} rank={ri.rank}/>
          </div>
          <div>
            <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:2}}>EDITANDO JUGADOR</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{fontSize:17,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif",lineHeight:1.2}}>{uInfo?.name}</div>
              {(userMessages[selUser]||[]).filter(m=>m.from==="user"&&!m.read).length>0&&
                <span style={{background:"#E84A5F",color:"#FFF",fontSize:9,fontWeight:900,padding:"2px 7px",borderRadius:20,fontFamily:"'Rajdhani',sans-serif"}}>NUEVO MENSAJE</span>}
            </div>
            <div style={{fontSize:10,color:ri.color,letterSpacing:1,marginTop:2}}>[{ri.rank}] {ri.title} · Lv.{level}</div>
          </div>
        </div>
        <div style={{padding:16}}>
          {/* Quick stats */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
            {[{l:"NIVEL",v:level,c:ri.color},{l:"XP",v:(editData.totalXp||0).toLocaleString(),c:ri.color},{l:"MONEDAS",v:editData.coins||0,c:"#F59E0B"},{l:"EJERCICIOS",v:totalDone,c:"#34D399"},{l:"LOGROS",v:(editData.earnedAchs||[]).length,c:"#A78BFA"},{l:"RUTINAS",v:(editData.customRoutines||[]).length,c:"#60A5FA"}].map(s=>(
              <div key={s.l} style={{background:"#0F0F1C",borderRadius:10,padding:12,border:`1px solid ${s.c}22`,textAlign:"center"}}>
                <div style={{fontSize:18,fontWeight:700,color:s.c,fontFamily:"'Rajdhani',sans-serif"}}>{s.v}</div>
                <div style={{fontSize:8,color:"#444",letterSpacing:2}}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:14}}>
            <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:12}}>ACCIONES RÁPIDAS</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              {[50,100,250,500].map(amt=>(
                <button key={amt} onClick={()=>addXpAdmin(selUser,amt)} style={{padding:"9px 8px",background:"#A78BFA18",border:"1px solid #A78BFA33",borderRadius:8,color:"#A78BFA",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+{amt} XP</button>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[25,50,100,200].map(amt=>(
                <button key={amt} onClick={()=>addCoinsAdmin(selUser,amt)} style={{padding:"9px 8px",background:"#F59E0B18",border:"1px solid #F59E0B33",borderRadius:8,color:"#F59E0B",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+{amt} 🪙</button>
              ))}
            </div>
          </div>

          {/* Edit XP & Coins directly */}
          <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:14}}>
            <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:12}}>EDITAR VALORES</div>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:4}}>XP TOTAL</div>
              <input style={inp} type="number" value={editData.totalXp||0} onChange={e=>setEditData({...editData,totalXp:Math.max(0,parseInt(e.target.value)||0)})}/>
            </div>
            <div>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:4}}>MONEDAS</div>
              <input style={inp} type="number" value={editData.coins||0} onChange={e=>setEditData({...editData,coins:Math.max(0,parseInt(e.target.value)||0)})}/>
            </div>
          </div>

          {/* Change password */}
          <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:14}}>
            <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:12}}>CAMBIAR CONTRASEÑA</div>
            <div style={{position:"relative"}}>
              <input style={{...inp,paddingRight:44}} type={showNewPw?"text":"password"} placeholder="Nueva contraseña (mín 6 caracteres)" value={newPw} onChange={e=>setNewPw(e.target.value)}/>
              <button onClick={()=>setShowNewPw(!showNewPw)} style={{position:"absolute",right:10,top:10,background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:15}}>{showNewPw?"🙈":"👁"}</button>
            </div>
            {newPw.length>0&&newPw.length<6&&<div style={{fontSize:11,color:"#F87171",marginBottom:8}}>Mínimo 6 caracteres</div>}
          </div>

          {/* Rutinas asignadas */}
          <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #60A5FA33",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:9,color:"#60A5FA",letterSpacing:3}}>RUTINAS ASIGNADAS ({(editData.customRoutines||[]).length})</div>
              <button onClick={()=>setAssignModal(selUser)} style={{padding:"5px 10px",background:"#60A5FA22",border:"1px solid #60A5FA44",borderRadius:7,color:"#60A5FA",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+ ASIGNAR</button>
            </div>
            {(editData.customRoutines||[]).length===0
              ? <div style={{fontSize:11,color:"#333",textAlign:"center",padding:"12px 0"}}>Sin rutinas asignadas</div>
              : (editData.customRoutines||[]).map(rt=>{
                  const c=rt.color||"#60A5FA";
                  const total=rt.sessions?.reduce((a,s)=>a+s.exercises.length,0)||0;
                  return(
                    <div key={rt.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #1A1A2E"}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:c,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{rt.name}</div>
                        <div style={{fontSize:10,color:"#444"}}>{rt.sessions?.length||0} sesión(es) · {total} ejercicios{rt.assignedByAdmin?" · 👑 Admin":""}</div>
                      </div>
                      <button onClick={()=>removeRoutineFromUser(selUser,rt.id)} style={{background:"none",border:"none",color:"#E84A5F",fontSize:14,cursor:"pointer",padding:4}}>✕</button>
                    </div>
                  );
                })
            }
          </div>

          {/* Dietas asignadas */}
          <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #34D39933",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:9,color:"#34D399",letterSpacing:3}}>DIETAS ASIGNADAS ({(editData.assignedDiets||[]).length})</div>
              <button onClick={()=>setAssignDietModal(selUser)} style={{padding:"5px 10px",background:"#34D39922",border:"1px solid #34D39944",borderRadius:7,color:"#34D399",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+ ASIGNAR</button>
            </div>
            {(editData.assignedDiets||[]).length===0
              ? <div style={{fontSize:11,color:"#333",textAlign:"center",padding:"12px 0"}}>Sin dietas asignadas</div>
              : (editData.assignedDiets||[]).map(dt=>{
                  const c=dt.color||"#34D399";
                  return(
                    <div key={dt.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #1A1A2E"}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:c,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{dt.name}</div>
                        <div style={{fontSize:10,color:"#444"}}>{dt.calories&&`${dt.calories} · `}{dt.meals?.length||0} comidas{dt.assignedByAdmin?" · 👑 Admin":""}</div>
                      </div>
                      <button onClick={()=>removeDietFromUser(selUser,dt.id)} style={{background:"none",border:"none",color:"#E84A5F",fontSize:14,cursor:"pointer",padding:4}}>✕</button>
                    </div>
                  );
                })
            }
          </div>

          {/* Programa asignado */}
          <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #E8C54733",marginBottom:14}}>
            <div style={{fontSize:9,color:"#E8C547",letterSpacing:3,marginBottom:12}}>⚔️ PROGRAMA ASIGNADO</div>
            {editData.assignedProgram?(
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{editData.assignedProgram.name}</div>
                  <div style={{fontSize:10,color:"#555"}}>{editData.assignedProgram.phases?.length||0} fases · 👑 Admin</div>
                </div>
                <button onClick={()=>{
                  const data=getUD(selUser)||defaultData();
                  data.assignedProgram=null;
                  saveUserData(selUser,data);
                  setEditData({...editData,assignedProgram:null});
                  flash("🗑️ Programa retirado");
                }} style={{background:"none",border:"none",color:"#E84A5F",fontSize:14,cursor:"pointer",padding:4}}>✕</button>
              </div>
            ):(
              <div style={{fontSize:11,color:"#333",marginBottom:10}}>Sin programa asignado</div>
            )}
            <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:2,marginBottom:8}}>PLANTILLAS DISPONIBLES</div>
            {(()=>{
              const customProgs=()=>{try{return JSON.parse(localStorage.getItem("rku_admin_programs")||"[]");}catch{return[];}};
              const allProgs=[...PROGRAM_TEMPLATES,...customProgs()];
              return allProgs.map(tpl=>{
              const isAssigned=editData.assignedProgram?.id===tpl.id;
              return(
                <button key={tpl.id} onClick={()=>{
                  if(isAssigned) return;
                  const data=getUD(selUser)||defaultData();
                  data.assignedProgram=tpl;
                  saveUserData(selUser,data);
                  setEditData({...editData,assignedProgram:tpl});
                  flash(`✅ Programa "${tpl.name}" asignado`);
                }} style={{width:"100%",padding:"10px 12px",background:isAssigned?"#E8C54722":"#07070F",border:`1px solid ${isAssigned?"#E8C547":"#2A2A44"}`,borderRadius:9,cursor:isAssigned?"default":"pointer",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                  <span style={{fontSize:20}}>{tpl.icon}</span>
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontSize:13,fontWeight:700,color:isAssigned?"#E8C547":"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{tpl.name}</div>
                    <div style={{fontSize:10,color:"#555"}}>{tpl.desc}</div>
                  </div>
                  {isAssigned&&<span style={{fontSize:10,color:"#E8C547"}}>✓ ASIGNADO</span>}
                </button>
              );
            });
            })()}
          </div>

          {/* Mensajes */}
          {(()=>{
            const msgs=userMessages[selUser]||[];
            const unread=msgs.filter(m=>m.from==="user"&&!m.read).length;
            const formatDate=iso=>{if(!iso)return"";const d=new Date(iso);return`${d.getDate()}/${d.getMonth()+1} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;}
            return(
              <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:`1px solid ${unread>0?"#E84A5F33":"#A78BFA22"}`,marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3}}>✉️ MENSAJES ({msgs.length}){unread>0&&<span style={{marginLeft:8,background:"#E84A5F",color:"#FFF",fontSize:8,padding:"1px 6px",borderRadius:10,fontWeight:900}}>{unread} NUEVO{unread>1?"S":""}</span>}</div>
                </div>
                <div style={{maxHeight:220,overflowY:"auto",display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                  {msgs.length===0&&<div style={{fontSize:11,color:"#333",textAlign:"center",padding:"12px 0"}}>Sin mensajes aún</div>}
                  {msgs.map((m,i)=>{
                    const isAdmin=m.from==="admin";
                    return(
                      <div key={m.id||i} style={{display:"flex",justifyContent:isAdmin?"flex-end":"flex-start"}}>
                        <div style={{maxWidth:"85%",padding:"8px 12px",borderRadius:isAdmin?"12px 12px 4px 12px":"12px 12px 12px 4px",
                          background:isAdmin?"#A78BFA22":"#1A1A2E",
                          border:`1px solid ${isAdmin?"#A78BFA44":"#2A2A3E"}`}}>
                          {!isAdmin&&<div style={{fontSize:8,color:"#A78BFA",letterSpacing:1,marginBottom:3}}>{m.name||"Usuario"}</div>}
                          <div style={{fontSize:12,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",lineHeight:1.4}}>{m.text}</div>
                          <div style={{fontSize:9,color:"#444",marginTop:3,textAlign:"right"}}>{formatDate(m.date)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input value={adminMsgInput} onChange={e=>setAdminMsgInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter")sendAdminMessage(selUser,adminMsgInput);}}
                    placeholder="Responder al usuario..."
                    style={{flex:1,padding:"9px 12px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:9,color:"#FFF",fontSize:12,outline:"none",fontFamily:"'Rajdhani',sans-serif"}}/>
                  <button onClick={()=>sendAdminMessage(selUser,adminMsgInput)}
                    style={{padding:"9px 14px",background:"#A78BFA",border:"none",borderRadius:9,color:"#07070F",fontSize:13,fontWeight:700,cursor:"pointer"}}>➤</button>
                </div>
              </div>
            );
          })()}

          {/* Historial de compras */}
          {(()=>{
            const rawRedeemed=editData.redeemedRewards||[];
            const redObjs=rawRedeemed.map(e=>typeof e==="object"?e:{id:e,name:REWARDS.find(r=>r.id===e)?.name||e,icon:REWARDS.find(r=>r.id===e)?.icon||"🪙",cost:REWARDS.find(r=>r.id===e)?.cost||0,date:null});
            const totalSpent=redObjs.reduce((a,e)=>a+(e.cost||0),0);
            const formatDate=iso=>{if(!iso)return"—";const d=new Date(iso);return`${d.getDate().toString().padStart(2,"0")}/${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getFullYear()} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;};
            return(
              <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #F59E0B33",marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#F59E0B",letterSpacing:3}}>📜 HISTORIAL DE COMPRAS ({redObjs.length})</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif"}}>{totalSpent.toLocaleString()} 🪙 gastadas</div>
                </div>
                {redObjs.length===0
                  ?<div style={{fontSize:11,color:"#333",textAlign:"center",padding:"12px 0"}}>Sin compras realizadas</div>
                  :[...redObjs].reverse().map((entry,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #1A1A2E"}}>
                      <span style={{fontSize:22,flexShrink:0}}>{entry.icon}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{entry.name}</div>
                        <div style={{fontSize:10,color:"#444"}}>{formatDate(entry.date)}</div>
                      </div>
                      <div style={{fontSize:13,fontWeight:700,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif",flexShrink:0}}>-{(entry.cost||0).toLocaleString()} 🪙</div>
                    </div>
                  ))
                }
              </div>
            );
          })()}

          {/* Danger zone */}
          <div style={{background:"#120808",borderRadius:12,padding:14,border:"1px solid #E84A5F33",marginBottom:16}}>
            <div style={{fontSize:9,color:"#E84A5F88",letterSpacing:3,marginBottom:12}}>⚠️ ZONA PELIGROSA</div>
            <button onClick={()=>{resetProgress(selUser);}} style={{width:"100%",padding:11,background:"#E84A5F18",border:"1px solid #E84A5F44",borderRadius:8,color:"#E84A5F",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",marginBottom:8}}>🔄 REINICIAR PROGRESO</button>
            <button onClick={()=>setConfirmDel(selUser)} style={{width:"100%",padding:11,background:"#E84A5F33",border:"1px solid #E84A5F",borderRadius:8,color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>🗑️ ELIMINAR USUARIO</button>
          </div>

          <button onClick={saveEdit} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#A78BFA,#7C3AED)",border:"none",borderRadius:10,color:"#FFF",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>💾 GUARDAR CAMBIOS</button>
        </div>

        {/* Confirm delete modal */}
        {confirmDel&&(
          <div onClick={()=>setConfirmDel(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D1A",border:"2px solid #E84A5F",borderRadius:16,padding:28,maxWidth:300,width:"100%",textAlign:"center"}}>
              <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
              <div style={{fontSize:16,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif",marginBottom:8}}>¿Eliminar usuario?</div>
              <div style={{fontSize:12,color:"#888",marginBottom:20}}>Se borrarán todos los datos de <strong style={{color:"#FFF"}}>{allUsers[confirmDel]?.name}</strong> permanentemente.</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setConfirmDel(null)} style={{flex:1,padding:12,background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#888",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>CANCELAR</button>
                <button onClick={()=>{deleteUser(confirmDel);setSelUser(null);setEditData(null);}} style={{flex:1,padding:12,background:"#E84A5F",border:"none",borderRadius:8,color:"#FFF",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>ELIMINAR</button>
              </div>
            </div>
          </div>
        )}

        {/* Assign routine modal */}
        {assignModal&&(
          <div onClick={()=>setAssignModal(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.88)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D1A",border:"1px solid #60A5FA44",borderRadius:"16px 16px 0 0",padding:20,width:"100%",maxWidth:430,maxHeight:"70vh",overflowY:"auto"}}>
              <div style={{fontSize:9,color:"#60A5FA",letterSpacing:3,marginBottom:12}}>SELECCIONA RUTINA PARA ASIGNAR</div>
              {adminRoutines.length===0
                ? <div style={{textAlign:"center",padding:"24px 0",color:"#444",fontSize:12}}>No hay rutinas creadas aún.<br/>Ve a la pestaña 🛠️ Rutinas del admin.</div>
                : adminRoutines.map(rt=>{
                    const c=rt.color||"#A78BFA";
                    const total=rt.sessions?.reduce((a,s)=>a+s.exercises.length,0)||0;
                    const alreadyHas=(editData.customRoutines||[]).find(r=>r.id===rt.id);
                    return(
                      <div key={rt.id} onClick={()=>!alreadyHas&&assignRoutineToUser(assignModal,rt)}
                        style={{display:"flex",alignItems:"center",gap:12,padding:"12px 10px",borderRadius:10,marginBottom:8,background:alreadyHas?"#1A1A2E":"#0F0F1C",border:`1px solid ${alreadyHas?"#2A2A44":c+"44"}`,cursor:alreadyHas?"default":"pointer",opacity:alreadyHas?.6:1}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:c,flexShrink:0}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:700,color:alreadyHas?"#555":"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{rt.name}</div>
                          <div style={{fontSize:10,color:"#444"}}>{rt.sessions?.length||0} sesiones · {total} ejercicios</div>
                        </div>
                        {alreadyHas?<span style={{fontSize:10,color:"#555"}}>Ya asignada</span>:<span style={{fontSize:18,color:c}}>+</span>}
                      </div>
                    );
                  })
              }
            </div>
          </div>
        )}

        {/* Assign diet modal */}
        {assignDietModal&&(
          <div onClick={()=>setAssignDietModal(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.88)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D1A",border:"1px solid #34D39944",borderRadius:"16px 16px 0 0",padding:20,width:"100%",maxWidth:430,maxHeight:"70vh",overflowY:"auto"}}>
              <div style={{fontSize:9,color:"#34D399",letterSpacing:3,marginBottom:12}}>SELECCIONA DIETA PARA ASIGNAR</div>
              {adminDiets.length===0
                ? <div style={{textAlign:"center",padding:"24px 0",color:"#444",fontSize:12}}>No hay dietas creadas aún.<br/>Ve a la pestaña 🥗 Dietas del admin.</div>
                : adminDiets.map(dt=>{
                    const c=dt.color||"#34D399";
                    const alreadyHas=(editData.assignedDiets||[]).find(d=>d.id===dt.id);
                    return(
                      <div key={dt.id} onClick={()=>!alreadyHas&&assignDietToUser(assignDietModal,dt)}
                        style={{display:"flex",alignItems:"center",gap:12,padding:"12px 10px",borderRadius:10,marginBottom:8,background:alreadyHas?"#1A1A2E":"#0F0F1C",border:`1px solid ${alreadyHas?"#2A2A44":c+"44"}`,cursor:alreadyHas?"default":"pointer",opacity:alreadyHas?.6:1}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:c,flexShrink:0}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:700,color:alreadyHas?"#555":"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{dt.name}</div>
                          <div style={{fontSize:10,color:"#444"}}>{dt.goal&&`${dt.goal} · `}{dt.calories&&`${dt.calories} · `}{dt.meals?.length||0} comidas</div>
                        </div>
                        {alreadyHas?<span style={{fontSize:10,color:"#555"}}>Ya asignada</span>:<span style={{fontSize:18,color:c}}>+</span>}
                      </div>
                    );
                  })
              }
            </div>
          </div>
        )}

        {/* Flash message */}
        {msg&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:msg.ok?"#0F1F0F":"#1F0F0F",border:`1px solid ${msg.ok?"#34D399":"#E84A5F"}`,borderRadius:10,padding:"10px 20px",color:msg.ok?"#34D399":"#E84A5F",fontSize:13,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",zIndex:9999,whiteSpace:"nowrap"}}>{msg.text}</div>}
      </div>
    );
  }

  return(
    <div style={{minHeight:"100dvh",background:"#07070F",color:"#E8E6FF",fontFamily:"'Rajdhani','Segoe UI',sans-serif",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(180deg,#0D0D1F,#07070F)",padding:"16px 16px 14px",borderBottom:"1px solid #A78BFA33",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:100}}>
        <div>
          <div style={{fontSize:9,color:"#A78BFA",letterSpacing:5}}>PANEL DE CONTROL</div>
          <div style={{fontSize:20,fontWeight:900,color:"#FFF",fontFamily:"'Cinzel',serif",lineHeight:1}}>ADMINISTRADOR</div>
        </div>
        <button onClick={onLogout} style={{background:"#1A1A2E",border:"1px solid #E84A5F44",borderRadius:8,color:"#E84A5F",padding:"8px 14px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>SALIR</button>
      </div>

      {/* Tab bar */}
      <div style={{display:"flex",gap:8,padding:"10px 16px",background:"#0A0A14",borderBottom:"1px solid #1E1E32"}}>
        {TABS_ADMIN.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"9px 8px",borderRadius:8,cursor:"pointer",background:tab===t.id?"#A78BFA22":"transparent",border:`1px solid ${tab===t.id?"#A78BFA":"#1E1E32"}`,color:tab===t.id?"#A78BFA":"#555",fontSize:12,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>
            {t.l}
          </button>
        ))}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"14px 16px 30px"}}>
        {tab==="rutinas"&&(
          <div>
            {showRoutineBuilder?(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                  <button onClick={()=>setShowRoutineBuilder(false)} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#A78BFA",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
                  <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif"}}>{editingRoutine?"EDITAR RUTINA":"NUEVA RUTINA"}</div>
                </div>

                {/* Name */}
                <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:8}}>NOMBRE</div>
                  <input style={inp} placeholder="Nombre de la rutina..." value={rtName} onChange={e=>setRtName(e.target.value)}/>
                </div>

                {/* Color */}
                <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:8}}>COLOR</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {COLORS.map(c=>(
                      <div key={c} onClick={()=>setRtColor(c)} style={{width:28,height:28,borderRadius:8,background:c,cursor:"pointer",border:rtColor===c?"3px solid #FFF":"2px solid transparent",boxShadow:rtColor===c?`0 0 10px ${c}`:"none"}}/>
                    ))}
                  </div>
                </div>

                {/* Sessions */}
                {rtSessions.map((sess,si)=>(
                  <div key={si} style={{background:"#0D0D1A",borderRadius:12,padding:14,border:`1px solid ${rtColor}33`,marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <input value={sess.day} onChange={e=>{const s=[...rtSessions];s[si]={...s[si],day:e.target.value};setRtSessions(s);}}
                        style={{...inp,marginBottom:0,width:"auto",flex:1,marginRight:8,fontSize:12,fontWeight:700,color:rtColor,background:"transparent",border:"none",borderBottom:`1px solid ${rtColor}44`,borderRadius:0,padding:"4px 0"}}/>
                      {rtSessions.length>1&&<button onClick={()=>setRtSessions(rtSessions.filter((_,i)=>i!==si))} style={{background:"none",border:"none",color:"#E84A5F",cursor:"pointer",fontSize:16}}>✕</button>}
                    </div>

                    {/* Exercises in session */}
                    {sess.exercises.map((ex,ei)=>(
                      <div key={ei} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,background:"#07070F",borderRadius:8,padding:"6px 10px"}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",fontWeight:700}}>{ex.name}</div>
                          <div style={{fontSize:10,color:"#555"}}>{ex.sets} · {ex.rest} descanso</div>
                        </div>
                        <button onClick={()=>{const s=[...rtSessions];s[si].exercises=s[si].exercises.filter((_,i)=>i!==ei);setRtSessions(s);}} style={{background:"none",border:"none",color:"#E84A5F",cursor:"pointer",fontSize:13}}>✕</button>
                      </div>
                    ))}

                    {/* Add exercise */}
                    <div style={{marginTop:8}}>
                      {/* DB picker */}
                      <select style={{...inp,marginBottom:6,color:"#AAA",fontSize:11}} onChange={e=>{
                        if(!e.target.value) return;
                        const ex=EXERCISE_DB.find(x=>x.name===e.target.value);
                        if(ex) setRtExInput(p=>({...p,[si]:{...p[si],name:ex.name,sets:p[si]?.sets||"3x10",rest:p[si]?.rest||"60s",xp:ex.xpBase}}));
                        e.target.value="";
                      }}>
                        <option value="">📚 Buscar en base de ejercicios...</option>
                        {Object.keys(MUSCLE_DEFS).map(m=>(
                          <optgroup key={m} label={MUSCLE_DEFS[m].label}>
                            {EXERCISE_DB.filter(e=>e.muscle.includes(m)).map(e=>(
                              <option key={e.id} value={e.name}>{e.name} ({e.xpBase}XP)</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:6}}>
                        <input placeholder="Ejercicio..." value={rtExInput[si]?.name||""} onChange={e=>setRtExInput(p=>({...p,[si]:{...p[si],name:e.target.value}}))}
                          style={{...inp,marginBottom:0,fontSize:11}}/>
                        <input placeholder="3x10" value={rtExInput[si]?.sets||""} onChange={e=>setRtExInput(p=>({...p,[si]:{...p[si],sets:e.target.value}}))}
                          style={{...inp,marginBottom:0,fontSize:11,width:60}}/>
                        <input placeholder="60s" value={rtExInput[si]?.rest||""} onChange={e=>setRtExInput(p=>({...p,[si]:{...p[si],rest:e.target.value}}))}
                          style={{...inp,marginBottom:0,fontSize:11,width:50}}/>
                        <button onClick={()=>{
                          const ex=rtExInput[si];
                          if(!ex?.name?.trim()) return;
                          const s=[...rtSessions];
                          s[si].exercises=[...s[si].exercises,{name:ex.name.trim(),sets:ex.sets||"3x10",rest:ex.rest||"60s",xp:ex.xp||40,done:false}];
                          setRtSessions(s);
                          setRtExInput(p=>({...p,[si]:{name:"",sets:"",rest:""}}));
                        }} style={{padding:"0 10px",background:`${rtColor}22`,border:`1px solid ${rtColor}44`,borderRadius:8,color:rtColor,fontWeight:700,cursor:"pointer",fontSize:16}}>+</button>
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button onClick={()=>setRtSessions(p=>[...p,{day:`Día ${p.length+1}`,exercises:[]}])}
                    style={{flex:1,padding:11,background:"#0D0D1A",border:`1px dashed ${rtColor}44`,borderRadius:10,color:rtColor,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>
                    + AÑADIR SESIÓN
                  </button>
                  <button onClick={()=>{
                    const copies=rtSessions.map(s=>({
                      ...JSON.parse(JSON.stringify(s)),
                      day:s.day.includes(" A")?s.day.replace(" A"," B"):s.day+" B"
                    }));
                    setRtSessions(p=>[...p,...copies]);
                  }} style={{flex:1,padding:11,background:"#34D39911",border:"1px dashed #34D39944",borderRadius:10,color:"#34D399",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>
                    🔄 DUPLICAR SEMANA B
                  </button>
                </div>

                {/* Multiply weeks button */}
                {rtSessions.length>0&&(
                  <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                    {[2,3,4].map(weeks=>(
                      <button key={weeks} onClick={()=>{
                        const base=JSON.parse(JSON.stringify(rtSessions));
                        const copies=[];
                        for(let w=1;w<weeks;w++){
                          base.forEach((sess,i)=>{
                            copies.push({
                              ...JSON.parse(JSON.stringify(sess)),
                              day:`${sess.day} (S${w+1})`
                            });
                          });
                        }
                        setRtSessions([...base,...copies]);
                      }} style={{flex:1,padding:9,background:`${rtColor}11`,border:`1px solid ${rtColor}33`,borderRadius:9,color:rtColor,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",minWidth:80}}>
                        🔁 ×{weeks} sem
                      </button>
                    ))}
                    {/* A/B alternating button — only show if sessions have A and B */}
                    <button onClick={()=>{
                      const base=JSON.parse(JSON.stringify(rtSessions));
                      const hasAB=base.some(s=>s.day.includes(" A")||s.day.toUpperCase().includes("SEMANA A"));
                      if(!hasAB){
                        // Auto-label: first half = A, second half = B
                        const half=Math.ceil(base.length/2);
                        const sessA=base.slice(0,half).map(s=>({...s,day:s.day+" A"}));
                        const sessB=base.slice(half).length>0
                          ?base.slice(half).map(s=>({...s,day:s.day+" B"}))
                          :sessA.map(s=>({...JSON.parse(JSON.stringify(s)),day:s.day.replace(" A"," B")}));
                        // Alternate A/B for 4 weeks
                        const result=[];
                        for(let w=0;w<4;w++){
                          const week=w%2===0?sessA:sessB;
                          week.forEach(s=>result.push({...JSON.parse(JSON.stringify(s)),day:`${s.day} S${w+1}`}));
                        }
                        setRtSessions(result);
                      } else {
                        // Sessions already labeled A/B — alternate for 4 weeks
                        const sessA=base.filter(s=>s.day.includes(" A"));
                        const sessB=base.filter(s=>s.day.includes(" B"));
                        const result=[];
                        for(let w=0;w<4;w++){
                          const week=w%2===0?sessA:sessB;
                          week.forEach(s=>result.push({...JSON.parse(JSON.stringify(s)),day:`${s.day} S${w+1}`}));
                        }
                        setRtSessions(result);
                      }
                    }} style={{flex:1,padding:9,background:"#34D39911",border:"1px solid #34D39933",borderRadius:9,color:"#34D399",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",minWidth:80}}>
                      🔄 A/B ×4
                    </button>
                  </div>
                )}

                <button onClick={saveRoutine} disabled={!rtName.trim()}
                  style={{width:"100%",padding:14,background:rtName.trim()?`linear-gradient(135deg,${rtColor},${rtColor}99)`:"#1A1A2E",border:"none",borderRadius:10,color:"#FFF",fontSize:14,fontWeight:700,cursor:rtName.trim()?"pointer":"default",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>
                  💾 GUARDAR RUTINA
                </button>
              </div>
            ):(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3}}>RUTINAS DEL ADMIN ({adminRoutines.length})</div>
                  <button onClick={openNewRoutine} style={{padding:"8px 14px",background:"#A78BFA22",border:"1px solid #A78BFA44",borderRadius:8,color:"#A78BFA",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+ NUEVA</button>
                </div>

                {adminRoutines.length===0
                  ? <div style={{textAlign:"center",padding:"60px 20px",color:"#333"}}>
                      <div style={{fontSize:40,marginBottom:12}}>🛠️</div>
                      <div style={{fontSize:13,color:"#444",marginBottom:16}}>Aún no hay rutinas.<br/>Crea una para asignarla a tus jugadores.</div>
                      <button onClick={openNewRoutine} style={{padding:"12px 24px",background:"linear-gradient(135deg,#A78BFA,#7C3AED)",border:"none",borderRadius:10,color:"#FFF",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>CREAR PRIMERA RUTINA</button>
                    </div>
                  : adminRoutines.map(rt=>{
                      const c=rt.color||"#A78BFA";
                      const totalEx=rt.sessions?.reduce((a,s)=>a+s.exercises.length,0)||0;
                      const assignedTo=userList.filter(u=>{const d=getUD(u.email)||defaultData();return (d.customRoutines||[]).find(r=>r.id===rt.id);});
                      return(
                        <div key={rt.id} style={{background:"#0F0F1C",border:`1px solid ${c}33`,borderRadius:12,padding:14,marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{width:10,height:10,borderRadius:"50%",background:c,flexShrink:0,boxShadow:`0 0 8px ${c}`}}/>
                              <div>
                                <div style={{fontSize:15,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{rt.name}</div>
                                <div style={{fontSize:10,color:"#555"}}>{rt.sessions?.length||0} sesiones · {totalEx} ejercicios</div>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={()=>openEditRoutine(rt)} style={{padding:"5px 9px",background:"transparent",border:`1px solid ${c}44`,borderRadius:7,color:c,fontSize:11,cursor:"pointer"}}>✏️</button>
                              <button onClick={()=>deleteAdminRoutine(rt.id)} style={{padding:"5px 9px",background:"transparent",border:"1px solid #E84A5F44",borderRadius:7,color:"#E84A5F",fontSize:11,cursor:"pointer"}}>🗑</button>
                            </div>
                          </div>
                          {assignedTo.length>0&&(
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
                              <span style={{fontSize:9,color:"#444",letterSpacing:2}}>ASIGNADA A:</span>
                              {assignedTo.map(u=>(
                                <span key={u.email} style={{fontSize:10,padding:"2px 8px",background:`${c}18`,border:`1px solid ${c}33`,borderRadius:20,color:c}}>{u.name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                }
              </div>
            )}
          </div>
        )}

        {tab==="dietas"&&(
          <div>
            {showDietBuilder?(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                  <button onClick={()=>setShowDietBuilder(false)} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#34D399",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
                  <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif"}}>{editingDiet?"EDITAR DIETA":"NUEVA DIETA"}</div>
                </div>

                {/* Nombre y color */}
                <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:8}}>NOMBRE DE LA DIETA</div>
                  <input style={inp} placeholder="Ej: Volumen limpio, Déficit verano..." value={dtName} onChange={e=>setDtName(e.target.value)}/>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:8,marginTop:4}}>COLOR</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {COLORS.map(c=>(
                      <div key={c} onClick={()=>setDtColor(c)} style={{width:26,height:26,borderRadius:7,background:c,cursor:"pointer",border:dtColor===c?"3px solid #FFF":"2px solid transparent",boxShadow:dtColor===c?`0 0 10px ${c}`:"none"}}/>
                    ))}
                  </div>
                </div>

                {/* Info nutricional */}
                <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:10}}>INFO NUTRICIONAL</div>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:4}}>OBJETIVO</div>
                    <input style={{...inp,marginBottom:0}} placeholder="Ej: Pérdida de grasa · Déficit 400 kcal" value={dtGoal} onChange={e=>setDtGoal(e.target.value)}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
                    <div>
                      <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:4}}>CALORÍAS</div>
                      <input style={{...inp,marginBottom:0}} placeholder="Ej: 2000 kcal" value={dtCalories} onChange={e=>setDtCalories(e.target.value)}/>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:4}}>PROTEÍNA</div>
                      <input style={{...inp,marginBottom:0}} placeholder="Ej: 2g/kg" value={dtProtein} onChange={e=>setDtProtein(e.target.value)}/>
                    </div>
                  </div>
                </div>

                {/* Comidas */}
                <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:`1px solid ${dtColor}33`,marginBottom:12}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:12}}>COMIDAS DEL DÍA</div>
                  {dtMeals.map((m,i)=>(
                    <div key={i} style={{background:"#07070F",borderRadius:10,padding:10,marginBottom:8,border:"1px solid #1A1A2E"}}>
                      <div style={{display:"grid",gridTemplateColumns:"80px 1fr auto",gap:6,marginBottom:6}}>
                        <input value={m.time} onChange={e=>{const ms=[...dtMeals];ms[i]={...ms[i],time:e.target.value};setDtMeals(ms);}}
                          style={{...inp,marginBottom:0,fontSize:12,textAlign:"center"}} placeholder="08:00"/>
                        <input value={m.name} onChange={e=>{const ms=[...dtMeals];ms[i]={...ms[i],name:e.target.value};setDtMeals(ms);}}
                          style={{...inp,marginBottom:0,fontSize:12,fontWeight:700,color:dtColor}} placeholder="Nombre comida..."/>
                        {dtMeals.length>1&&<button onClick={()=>setDtMeals(dtMeals.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#E84A5F",cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>}
                      </div>
                      <textarea value={m.desc} onChange={e=>{const ms=[...dtMeals];ms[i]={...ms[i],desc:e.target.value};setDtMeals(ms);}}
                        style={{...inp,marginBottom:4,fontSize:11,resize:"vertical",minHeight:52,lineHeight:1.5}} placeholder="Descripción: 150g pollo · Arroz integral · Ensalada..."/>
                      {/* Food DB picker */}
                      <select style={{...inp,marginBottom:0,color:"#AAA",fontSize:10}} onChange={e=>{
                        if(!e.target.value) return;
                        const food=FOOD_DB.find(f=>f.name===e.target.value);
                        if(food){
                          const ms=[...dtMeals];
                          const current=ms[i].desc||"";
                          ms[i]={...ms[i],desc:current+(current?"\n":"")+`${food.name} · ${food.kcal}kcal · P:${food.protein}g`};
                          setDtMeals(ms);
                        }
                        e.target.value="";
                      }}>
                        <option value="">🥗 Añadir alimento de la base de datos...</option>
                        {["platos","bebidas","snacks","postres"].map(cat=>(
                          <optgroup key={cat} label={cat.charAt(0).toUpperCase()+cat.slice(1)}>
                            {FOOD_DB.filter(f=>f.cat===cat).map(f=>(
                              <option key={f.name} value={f.name}>{f.name} ({f.kcal}kcal)</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  ))}
                  <button onClick={()=>setDtMeals(p=>[...p,{time:"",name:"",desc:""}])}
                    style={{width:"100%",padding:9,background:"transparent",border:`1px dashed ${dtColor}44`,borderRadius:8,color:dtColor,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>
                    + AÑADIR COMIDA
                  </button>
                </div>

                {/* Tips */}
                <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32",marginBottom:14}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:10}}>REGLAS / CONSEJOS</div>
                  {dtTips.map((t,i)=>(
                    <div key={i} style={{display:"flex",gap:6,marginBottom:6}}>
                      <input value={t} onChange={e=>{const ts=[...dtTips];ts[i]=e.target.value;setDtTips(ts);}}
                        style={{...inp,marginBottom:0,fontSize:12,flex:1}} placeholder={`Consejo ${i+1}...`}/>
                      {dtTips.length>1&&<button onClick={()=>setDtTips(dtTips.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#E84A5F",cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>}
                    </div>
                  ))}
                  <button onClick={()=>setDtTips(p=>[...p,""])}
                    style={{padding:"7px 12px",background:"transparent",border:"1px dashed #2A2A44",borderRadius:7,color:"#555",fontSize:11,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>
                    + AÑADIR CONSEJO
                  </button>
                </div>

                <button onClick={saveDiet} disabled={!dtName.trim()}
                  style={{width:"100%",padding:14,background:dtName.trim()?`linear-gradient(135deg,${dtColor},${dtColor}99)`:"#1A1A2E",border:"none",borderRadius:10,color:"#FFF",fontSize:14,fontWeight:700,cursor:dtName.trim()?"pointer":"default",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>
                  💾 GUARDAR DIETA
                </button>
              </div>
            ):(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3}}>DIETAS DEL ADMIN ({adminDiets.length})</div>
                  <button onClick={openNewDiet} style={{padding:"8px 14px",background:"#34D39922",border:"1px solid #34D39944",borderRadius:8,color:"#34D399",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+ NUEVA</button>
                </div>

                {adminDiets.length===0
                  ? <div style={{textAlign:"center",padding:"60px 20px",color:"#333"}}>
                      <div style={{fontSize:40,marginBottom:12}}>🥗</div>
                      <div style={{fontSize:13,color:"#444",marginBottom:16}}>Aún no hay dietas.<br/>Crea una para asignarla a tus jugadores.</div>
                      <button onClick={openNewDiet} style={{padding:"12px 24px",background:"linear-gradient(135deg,#34D399,#059669)",border:"none",borderRadius:10,color:"#FFF",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>CREAR PRIMERA DIETA</button>
                    </div>
                  : adminDiets.map(dt=>{
                      const c=dt.color||"#34D399";
                      const assignedTo=userList.filter(u=>{const d=getUD(u.email)||defaultData();return (d.assignedDiets||[]).find(x=>x.id===dt.id);});
                      return(
                        <div key={dt.id} style={{background:"#0F0F1C",border:`1px solid ${c}33`,borderRadius:12,padding:14,marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{width:10,height:10,borderRadius:"50%",background:c,flexShrink:0,boxShadow:`0 0 8px ${c}`}}/>
                              <div>
                                <div style={{fontSize:15,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{dt.name}</div>
                                <div style={{fontSize:10,color:"#555"}}>{dt.goal&&`${dt.goal} · `}{dt.meals?.length||0} comidas{dt.calories&&` · ${dt.calories}`}</div>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={()=>openEditDiet(dt)} style={{padding:"5px 9px",background:"transparent",border:`1px solid ${c}44`,borderRadius:7,color:c,fontSize:11,cursor:"pointer"}}>✏️</button>
                              <button onClick={()=>deleteAdminDiet(dt.id)} style={{padding:"5px 9px",background:"transparent",border:"1px solid #E84A5F44",borderRadius:7,color:"#E84A5F",fontSize:11,cursor:"pointer"}}>🗑</button>
                            </div>
                          </div>
                          {dt.protein&&<div style={{fontSize:10,color:c,opacity:.7,marginBottom:4}}>🥩 Proteína: {dt.protein}</div>}
                          {assignedTo.length>0&&(
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                              <span style={{fontSize:9,color:"#444",letterSpacing:2}}>ASIGNADA A:</span>
                              {assignedTo.map(u=>(
                                <span key={u.email} style={{fontSize:10,padding:"2px 8px",background:`${c}18`,border:`1px solid ${c}33`,borderRadius:20,color:c}}>{u.name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                }
              </div>
            )}
          </div>
        )}

        {tab==="programas"&&<ProgramasTab userList={userList} flash={flash}/>}

        {tab==="stats"&&(
          <div>
            <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:14}}>ESTADÍSTICAS GLOBALES</div>
            {/* Maintenance button */}
            <button onClick={()=>{
              const users=getUsers();
              // Remove ALL localStorage keys rku_data_ that don't belong to current users
              Object.keys(localStorage).filter(k=>k.startsWith('rku_data_')).forEach(k=>{
                const email=k.replace('rku_data_','');
                if(!users[email]) localStorage.removeItem(k);
              });
              // Also wipe customRoutines for all existing users
              Object.keys(users).forEach(email=>{
                const d=getUD(email)||defaultData();
                d.customRoutines=(d.customRoutines||[]).filter(r=>r.assignedByAdmin===true);
                saveUserData(email,d);
              });
              flash('🧹 Datos huérfanos eliminados');
            }} style={{width:'100%',padding:10,background:'#1A1A2E',border:'1px solid #444',borderRadius:9,color:'#888',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Rajdhani',sans-serif",marginBottom:14}}>
              🧹 LIMPIAR DATOS HUÉRFANOS
            </button>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              {[{icon:"👥",l:"USUARIOS",v:totalUsers,c:"#A78BFA"},{icon:"⚡",l:"XP TOTAL",v:totalXpAll.toLocaleString(),c:"#E8C547"},{icon:"🪙",l:"MONEDAS",v:totalCoinsAll.toLocaleString(),c:"#F59E0B"},{icon:"📅",l:"REGISTRADOS",v:totalUsers,c:"#34D399"}].map(s=>(
                <div key={s.l} style={{background:"#0F0F1C",borderRadius:12,padding:16,border:`1px solid ${s.c}22`,textAlign:"center"}}>
                  <div style={{fontSize:28,marginBottom:4}}>{s.icon}</div>
                  <div style={{fontSize:22,fontWeight:700,color:s.c,fontFamily:"'Rajdhani',sans-serif"}}>{s.v}</div>
                  <div style={{fontSize:9,color:"#444",letterSpacing:2}}>{s.l}</div>
                </div>
              ))}
            </div>
            <div style={{background:"#0D0D1A",borderRadius:12,padding:14,border:"1px solid #1E1E32"}}>
              <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:12}}>RANKING RANKUP</div>
              {[...userList].sort((a,b)=>{const da=getUD(a.email)||defaultData();const db=getUD(b.email)||defaultData();return (db.totalXp||0)-(da.totalXp||0);}).map((u,i)=>{
                const d=getUD(u.email)||defaultData();
                const lv=getLevel(d.totalXp||0);const ri=getRank(lv);
                return(
                  <div key={u.email} onClick={()=>openUser(u.email)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #1A1A2E",cursor:"pointer"}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#333",width:20,textAlign:"center",fontFamily:"'Rajdhani',sans-serif"}}>#{i+1}</div>
                    <div style={{width:32,height:32,borderRadius:8,border:`1.5px solid ${ri.color}`,background:`${ri.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:ri.color,fontFamily:"'Cinzel',serif",flexShrink:0}}>{ri.rank}</div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{u.name}</span>
                        {(()=>{const cls=CLASSES.find(c=>c.id===(getUD(u.email)||defaultData()).playerClass);return cls?<span style={{fontSize:12,padding:"1px 6px",background:`${cls.color}22`,border:`1px solid ${cls.color}44`,borderRadius:6,color:cls.color,fontFamily:"'Rajdhani',sans-serif",fontWeight:700}}>{cls.icon} {cls.name}</span>:null;})()}
                      </div>
                      <div style={{fontSize:10,color:"#444"}}>{u.email}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12,color:ri.color,fontWeight:700}}>Lv {lv}</div>
                      <div style={{fontSize:10,color:"#444"}}>{(d.totalXp||0).toLocaleString()} XP</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab==="ranking"&&(
          <RankingTab currentEmail="admin@rankup.fit" currentName="Admin"/>
        )}

        {tab==="usuarios"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3}}>USUARIOS REGISTRADOS ({totalUsers})</div>
              <button onClick={()=>setShowNewUserForm(v=>!v)}
                style={{padding:"7px 14px",background:"#A78BFA22",border:"1px solid #A78BFA55",borderRadius:9,color:"#A78BFA",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>
                {showNewUserForm?"✕ CANCELAR":"+ NUEVO USUARIO"}
              </button>
            </div>
            {showNewUserForm&&(
              <div style={{background:"#0D0D1A",border:"1px solid #A78BFA33",borderRadius:12,padding:16,marginBottom:14}}>
                <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3,marginBottom:12}}>CREAR NUEVO USUARIO</div>
                <input value={nuName} onChange={e=>setNuName(e.target.value)} placeholder="Nombre"
                  style={{width:"100%",padding:"10px 12px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:9,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:8,boxSizing:"border-box"}}/>
                <input value={nuEmail} onChange={e=>setNuEmail(e.target.value)} placeholder="Email" type="email"
                  style={{width:"100%",padding:"10px 12px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:9,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:8,boxSizing:"border-box"}}/>
                <input value={nuPass} onChange={e=>setNuPass(e.target.value)} placeholder="Contraseña (mín. 6 caracteres)" type="password"
                  style={{width:"100%",padding:"10px 12px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:9,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:12,boxSizing:"border-box"}}/>
                <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,cursor:"pointer"}}>
                  <input type="checkbox" checked={nuIsTest} onChange={e=>setNuIsTest(e.target.checked)}
                    style={{width:16,height:16,accentColor:"#A78BFA",cursor:"pointer"}}/>
                  <span style={{fontSize:11,color:"#666",fontFamily:"'Rajdhani',sans-serif"}}>Usuario de pruebas (no aparece en rankings ni stats)</span>
                </label>
                <button onClick={createNewUser}
                  style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,#A78BFA,#7C3AED)",border:"none",borderRadius:9,color:"#FFF",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>
                  ✓ CREAR USUARIO
                </button>
              </div>
            )}
            {userList.length===0?(
              <div style={{textAlign:"center",padding:"60px 20px",color:"#333"}}>
                <div style={{fontSize:40,marginBottom:12}}>👥</div>
                <div style={{fontSize:14,color:"#444"}}>Sin usuarios registrados aún</div>
              </div>
            ):(
              userList.sort((a,b)=>b.createdAt-a.createdAt).map(u=>{
                const d=getUD(u.email)||defaultData();
                const lv=getLevel(d.totalXp||0);const ri=getRank(lv);
                const totalDone=Object.values(d.checked||{}).filter(Boolean).length;
                const date=u.createdAt?new Date(u.createdAt).toLocaleDateString("es-ES",{day:"2-digit",month:"short"}):"—";
                return(
                  <div key={u.email} onClick={()=>openUser(u.email)} style={{background:"#0F0F1C",border:`1px solid ${ri.color}22`,borderRadius:12,padding:14,marginBottom:10,cursor:"pointer",transition:"border-color .2s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=ri.color+"66"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=ri.color+"22"}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                      <div style={{width:38,height:38,borderRadius:10,border:`2px solid ${ri.color}`,background:`${ri.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:ri.color,fontFamily:"'Cinzel',serif",flexShrink:0,overflow:"hidden"}}>
                        <AdminUserPhoto email={u.email} rank={ri.rank}/>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:15,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{u.name}</span>
                          {(userMessages[u.email]||[]).filter(m=>m.from==="user"&&!m.read).length>0&&
                            <span style={{background:"#E84A5F",color:"#FFF",fontSize:8,fontWeight:900,padding:"2px 6px",borderRadius:10,fontFamily:"'Rajdhani',sans-serif"}}>MSG</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:10,color:"#555"}}>{u.email}</span>
                          {u.isTest&&<span style={{fontSize:8,padding:"1px 6px",background:"#A78BFA22",border:"1px solid #A78BFA44",borderRadius:10,color:"#A78BFA",fontFamily:"'Rajdhani',sans-serif",fontWeight:700}}>TEST</span>}
                        </div>
                      </div>
                      <div style={{fontSize:10,color:"#333"}}>{date}</div>
                    </div>
                    <div style={{display:"flex",gap:10}}>
                      {[{l:"Lv",v:lv,c:ri.color},{l:"XP",v:(d.totalXp||0).toLocaleString(),c:ri.color},{l:"🪙",v:d.coins||0,c:"#F59E0B"},{l:"Ejercicios",v:totalDone,c:"#34D399"}].map(s=>(
                        <div key={s.l} style={{flex:1,textAlign:"center",background:"#07070F",borderRadius:8,padding:"6px 4px",border:"1px solid #1A1A2E"}}>
                          <div style={{fontSize:13,fontWeight:700,color:s.c,fontFamily:"'Rajdhani',sans-serif"}}>{s.v}</div>
                          <div style={{fontSize:9,color:"#444"}}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                    {(()=>{const cls=CLASSES.find(c=>c.id===d.playerClass);return cls?(
                      <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:`${cls.color}15`,border:`1px solid ${cls.color}44`,borderRadius:8}}>
                        <span style={{fontSize:14}}>{cls.icon}</span>
                        <div>
                          <span style={{fontSize:11,fontWeight:700,color:cls.color,fontFamily:"'Rajdhani',sans-serif"}}>{cls.name}</span>
                          <span style={{fontSize:10,color:"#555",marginLeft:6}}>{cls.bonus}</span>
                        </div>
                      </div>
                    ):(<div style={{marginTop:8,padding:"5px 10px",background:"#1A1A2E",borderRadius:8,fontSize:10,color:"#333"}}>Sin clase elegida</div>);})()}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Flash message */}
      {msg&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:msg.ok?"#0F1F0F":"#1F0F0F",border:`1px solid ${msg.ok?"#34D399":"#E84A5F"}`,borderRadius:10,padding:"10px 20px",color:msg.ok?"#34D399":"#E84A5F",fontSize:13,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",zIndex:9999,whiteSpace:"nowrap"}}>{msg.text}</div>}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App(){
  const s=getSession();
  const users=getUsers();
  const isAdminSession=s&&s.email===ADMIN_EMAIL;
  const [user,setUser]=useState(
    isAdminSession?{email:ADMIN_EMAIL,name:"Administrador",isAdmin:true}:
    (s&&users[s.email]?{email:s.email,name:users[s.email].name,isAdmin:false}:null)
  );
  if(!user) return <LoginScreen onLogin={(email,name,isAdmin)=>setUser({email,name,isAdmin})}/>;
  if(user.isAdmin) return <AdminPanel onLogout={()=>{clearSession();setUser(null);}}/>;
  return <RankUpApp user={user} onLogout={()=>{clearSession();setUser(null);}}/>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── CLASS SELECT MODAL ───────────────────────────────────────────────────────
function ClassSelectModal({current,onSelect}){
  const [hovered,setHovered]=useState(null);
  const [previewing,setPreviewing]=useState(null); // for mobile tap-to-preview
  const preview=previewing||hovered||current;
  const cls=CLASSES.find(c=>c.id===preview)||CLASSES[0];
  const isMobile=()=>window.matchMedia("(pointer:coarse)").matches;

  const handleTap=(id)=>{
    if(isMobile()){
      if(previewing===id){
        // second tap = confirm
        onSelect(id);
        setPreviewing(null);
      } else {
        // first tap = preview
        setPreviewing(id);
      }
    } else {
      onSelect(id);
    }
  };

  return(
    <div style={{position:"fixed",inset:0,zIndex:9995,background:"rgba(0,0,0,.92)",backdropFilter:"blur(8px)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{fontSize:9,letterSpacing:6,color:"#444",marginBottom:6}}>ELIGE TU CLASE</div>
      <div style={{fontSize:22,fontWeight:900,color:"#FFF",fontFamily:"'Cinzel',serif",marginBottom:4,textAlign:"center"}}>¿Cuál es tu objetivo?</div>
      <div style={{fontSize:11,color:"#555",marginBottom:16,textAlign:"center"}}>
        {isMobile()?"Toca para ver · Toca de nuevo para elegir":"Define tu camino en RankUp"}
      </div>

      {/* Preview card */}
      <div style={{background:`${cls.color}12`,border:`1px solid ${cls.color}44`,borderRadius:14,padding:"14px 18px",width:"100%",maxWidth:340,marginBottom:16,minHeight:80,transition:"all .2s"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:28}}>{cls.icon}</span>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:cls.color,fontFamily:"'Cinzel',serif"}}>{cls.name}</div>
            <div style={{fontSize:10,color:"#888"}}>{cls.goal}</div>
          </div>
        </div>
        <div style={{fontSize:11,color:"#AAA",lineHeight:1.5,marginBottom:6}}>{cls.desc}</div>
        <div style={{fontSize:10,color:cls.color,background:`${cls.color}18`,borderRadius:6,padding:"4px 8px",display:"inline-block"}}>🎯 {cls.bonus}</div>
        {previewing&&previewing!==current&&(
          <button onClick={()=>{onSelect(previewing);setPreviewing(null);}}
            style={{width:"100%",marginTop:10,padding:"10px 0",background:`${cls.color}`,border:"none",borderRadius:9,color:"#07070F",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>
            ✓ ELEGIR {cls.name.toUpperCase()}
          </button>
        )}
      </div>

      {/* Grid selector — 3 top + 2 bottom centradas para 5 clases */}
      <div style={{width:"100%",maxWidth:340,marginBottom:20}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
          {CLASSES.slice(0,3).map(c=>{
            const isSelected=current===c.id;
            const isPreviewing=previewing===c.id;
            return(
              <button key={c.id}
                onMouseEnter={()=>!isMobile()&&setHovered(c.id)}
                onMouseLeave={()=>!isMobile()&&setHovered(null)}
                onClick={()=>handleTap(c.id)}
                style={{padding:"12px 6px",borderRadius:10,cursor:"pointer",background:isSelected||isPreviewing?`${c.color}22`:"#0D0D1A",border:`1.5px solid ${isSelected||isPreviewing?c.color:"#1E1E32"}`,display:"flex",flexDirection:"column",alignItems:"center",gap:4,transition:"all .15s",boxShadow:isSelected||isPreviewing?`0 0 14px ${c.color}44`:"none"}}>
                <span style={{fontSize:22}}>{c.icon}</span>
                <div style={{fontSize:10,fontWeight:700,color:isSelected||isPreviewing?c.color:"#888",fontFamily:"'Rajdhani',sans-serif",letterSpacing:1}}>{c.name.toUpperCase()}</div>
                {isPreviewing&&<div style={{fontSize:8,color:c.color,letterSpacing:1}}>👆 TOCA</div>}
              </button>
            );
          })}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,width:"calc(66.6% + 4px)",margin:"0 auto"}}>
          {CLASSES.slice(3).map(c=>{
            const isSelected=current===c.id;
            const isPreviewing=previewing===c.id;
            return(
              <button key={c.id}
                onMouseEnter={()=>!isMobile()&&setHovered(c.id)}
                onMouseLeave={()=>!isMobile()&&setHovered(null)}
                onClick={()=>handleTap(c.id)}
                style={{padding:"12px 6px",borderRadius:10,cursor:"pointer",background:isSelected||isPreviewing?`${c.color}22`:"#0D0D1A",border:`1.5px solid ${isSelected||isPreviewing?c.color:"#1E1E32"}`,display:"flex",flexDirection:"column",alignItems:"center",gap:4,transition:"all .15s",boxShadow:isSelected||isPreviewing?`0 0 14px ${c.color}44`:"none"}}>
                <span style={{fontSize:22}}>{c.icon}</span>
                <div style={{fontSize:10,fontWeight:700,color:isSelected||isPreviewing?c.color:"#888",fontFamily:"'Rajdhani',sans-serif",letterSpacing:1}}>{c.name.toUpperCase()}</div>
                {isPreviewing&&<div style={{fontSize:8,color:c.color,letterSpacing:1}}>👆 TOCA</div>}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{fontSize:10,color:"#333",textAlign:"center"}}>Puedes cambiarla más tarde desde tu perfil</div>
    </div>
  );
}

function ProfileAvatar({userEmail,riColor,clsIcon}){
  const [photo,setPhoto]=useState(()=>localStorage.getItem(`rku_photo_${userEmail}`)||null);
  const [showEdit,setShowEdit]=useState(false);
  const [urlInput,setUrlInput]=useState("");
  const [error,setError]=useState("");
  const fileRef=useRef();

  // Load photo from Firebase on mount if not in localStorage
  useEffect(()=>{
    if(!photo){
      const key=userEmail.replace(/\./g,"_").replace(/@/g,"_at_");
      fbGet(`photos/${key}`).then(p=>{
        if(p){localStorage.setItem(`rku_photo_${userEmail}`,p);setPhoto(p);}
      }).catch(()=>{});
    }
  },[]);

  const savePhoto=(data)=>{
    const key=userEmail.replace(/\./g,"_").replace(/@/g,"_at_");
    localStorage.setItem(`rku_photo_${userEmail}`,data);
    setPhoto(data);
    fbSet(`photos/${key}`,data).catch(()=>{});
  };

  const handleFile=e=>{
    const file=e.target.files?.[0];
    if(!file) return;
    if(file.size>3*1024*1024){setError("Máximo 3MB");return;}
    const reader=new FileReader();
    reader.onload=ev=>{savePhoto(ev.target.result);setShowEdit(false);setError("");};
    reader.readAsDataURL(file);
  };

  const handleUrl=()=>{
    if(!urlInput.trim()){setError("Escribe una URL");return;}
    const img=new Image();
    img.onload=()=>{savePhoto(urlInput.trim());setShowEdit(false);setUrlInput("");setError("");};
    img.onerror=()=>setError("URL no válida o inaccesible");
    img.src=urlInput.trim();
  };

  const removePhoto=()=>{
    const key=userEmail.replace(/\./g,"_").replace(/@/g,"_at_");
    localStorage.removeItem(`rku_photo_${userEmail}`);
    fbSet(`photos/${key}`,null).catch(()=>{});
    setPhoto(null); setShowEdit(false);
  };

  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
      {/* Avatar */}
      <div style={{position:"relative",width:80,height:80,cursor:"pointer"}} onClick={()=>setShowEdit(!showEdit)}>
        <div style={{width:80,height:80,borderRadius:20,border:`2px solid ${riColor}`,background:`${riColor}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,boxShadow:`0 0 24px ${riColor}44`,overflow:"hidden"}}>
          {photo?<img src={photo} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={()=>{setPhoto(null);localStorage.removeItem(`rku_photo_${userEmail}`);}}/>:clsIcon}
        </div>
        <div style={{position:"absolute",bottom:-4,right:-4,width:22,height:22,borderRadius:"50%",background:riColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11}}>📷</div>
      </div>

      {/* Edit panel */}
      {showEdit&&(
        <div style={{width:"100%",background:"#07070F",border:`1px solid ${riColor}33`,borderRadius:12,padding:12}}>
          <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:10}}>CAMBIAR FOTO</div>

          {/* Option 1: file from device */}
          <button onClick={()=>fileRef.current?.click()} style={{width:"100%",padding:"10px 0",background:`${riColor}18`,border:`1px solid ${riColor}44`,borderRadius:9,color:riColor,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",marginBottom:8}}>
            📁 SUBIR DESDE DISPOSITIVO
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>

          {/* Option 2: URL */}
          <div style={{fontSize:9,color:"#333",letterSpacing:2,marginBottom:6}}>O PEGAR URL DE IMAGEN</div>
          <div style={{display:"flex",gap:6,marginBottom:6}}>
            <input value={urlInput} onChange={e=>setUrlInput(e.target.value)}
              placeholder="https://..." onKeyDown={e=>e.key==="Enter"&&handleUrl()}
              style={{flex:1,padding:"8px 10px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:11,outline:"none",fontFamily:"'Rajdhani',sans-serif"}}/>
            <button onClick={handleUrl} style={{padding:"8px 12px",background:"#34D39922",border:"1px solid #34D39944",borderRadius:8,color:"#34D399",fontSize:11,fontWeight:700,cursor:"pointer"}}>✓</button>
          </div>
          {error&&<div style={{fontSize:10,color:"#F87171",marginBottom:6}}>{error}</div>}

          <div style={{display:"flex",gap:6,marginTop:4}}>
            {photo&&<button onClick={removePhoto} style={{flex:1,padding:"8px 0",background:"#E84A5F18",border:"1px solid #E84A5F44",borderRadius:8,color:"#E84A5F",fontSize:11,fontWeight:700,cursor:"pointer"}}>🗑 ELIMINAR</button>}
            <button onClick={()=>{setShowEdit(false);setError("");}} style={{flex:1,padding:"8px 0",background:"transparent",border:"1px solid #2A2A44",borderRadius:8,color:"#555",fontSize:11,cursor:"pointer"}}>CANCELAR</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileFisico({userEmail}){
  const [showInput,setShowInput]=useState(false);
  const [newW,setNewW]=useState("");
  const [newH,setNewH]=useState("");
  const [userData,setUserData]=useState(()=>getUsers()[userEmail]||{});

  const h=userData.height||0;
  const w=userData.weight||0;
  const imc=h>0&&w>0?Math.round((w/(h/100)**2)*10)/10:0;
  const imcLabel=imc===0?"—":imc<18.5?"Bajo peso":imc<25?"Peso normal":imc<30?"Sobrepeso":"Obesidad";
  const imcColor=imc===0?"#444":imc<18.5?"#60A5FA":imc<25?"#34D399":imc<30?"#FBBF24":"#F87171";

  const update=()=>{
    const wVal=parseFloat(newW)||w;
    const hVal=parseInt(newH)||h;
    if(wVal<20||wVal>300||hVal<100||hVal>250) return;
    const users=getUsers();
    users[userEmail]={...users[userEmail],weight:wVal,height:hVal};
    saveUsers(users);
    setUserData(users[userEmail]);
    setNewW(""); setNewH(""); setShowInput(false);
  };

  return(
    <div style={{background:"#07070F",border:"1px solid #1A1A2E",borderRadius:10,padding:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:9,color:"#444",letterSpacing:3}}>FÍSICO</div>
        <button onClick={()=>setShowInput(!showInput)} style={{fontSize:10,color:"#555",background:"transparent",border:"none",cursor:"pointer",padding:0}}>
          {showInput?"✕ cerrar":"✏️ editar"}
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:9,color:"#444",marginBottom:2}}>ALTURA</div>
          <div style={{fontSize:13,fontWeight:700,color:"#FFF"}}>{h?`${h}cm`:"—"}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:9,color:"#444",marginBottom:2}}>PESO</div>
          <div style={{fontSize:13,fontWeight:700,color:"#FFF"}}>{w?`${w}kg`:"—"}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:9,color:"#444",marginBottom:2}}>IMC</div>
          <div style={{fontSize:13,fontWeight:700,color:imcColor}}>{imc||"—"}</div>
        </div>
      </div>
      {imc>0&&<div style={{fontSize:9,color:imcColor,textAlign:"center",marginBottom:8,padding:"4px 0",background:`${imcColor}14`,borderRadius:6}}>{imcLabel}</div>}
      {showInput&&(
        <div style={{borderTop:"1px solid #1A1A2E",paddingTop:10,marginTop:4}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
            <div>
              <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:4}}>ALTURA (cm)</div>
              <input value={newH} onChange={e=>setNewH(e.target.value)} placeholder={h?`${h}`:"170"} type="number"
                style={{width:"100%",padding:"8px 10px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:12,outline:"none",fontFamily:"'Rajdhani',sans-serif",boxSizing:"border-box"}}/>
            </div>
            <div>
              <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:4}}>PESO (kg)</div>
              <input value={newW} onChange={e=>setNewW(e.target.value)} placeholder={w?`${w}`:"70"} type="number" step="0.1"
                style={{width:"100%",padding:"8px 10px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:12,outline:"none",fontFamily:"'Rajdhani',sans-serif",boxSizing:"border-box"}}/>
            </div>
          </div>
          {/* IMC preview */}
          {(newW||newH)&&(()=>{
            const pw=parseFloat(newW)||w, ph=parseInt(newH)||h;
            const pi=ph>0&&pw>0?Math.round((pw/(ph/100)**2)*10)/10:0;
            const pl=pi===0?"":pi<18.5?"Bajo peso":pi<25?"Peso normal":pi<30?"Sobrepeso":"Obesidad";
            const pc=pi<18.5?"#60A5FA":pi<25?"#34D399":pi<30?"#FBBF24":"#F87171";
            return pi>0?<div style={{fontSize:10,color:pc,textAlign:"center",marginBottom:8,padding:"4px",background:`${pc}14`,borderRadius:6}}>IMC: {pi} — {pl}</div>:null;
          })()}
          <button onClick={update} style={{width:"100%",padding:"9px 0",background:"#34D39922",border:"1px solid #34D39944",borderRadius:8,color:"#34D399",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:1}}>
            💾 GUARDAR CAMBIOS
          </button>
        </div>
      )}
    </div>
  );
}

function RankingTab({currentEmail, currentName}){
  const [players,setPlayers]=useState([]);
  const [cat,setCat]=useState("xp");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const load=async()=>{
      setLoading(true);
      try{
        const users=await fbGet("users").catch(()=>({}));
        if(!users){setLoading(false);return;}
        // Load all user data in parallel
        const entries=Object.entries(users);
        const list=await Promise.all(entries.map(async([key,u])=>{
          const email=u.email||key.replace(/_at_/g,"@").replace(/_/g,".");
          const dataKey=email.replace(/\./g,"_").replace(/@/g,"_at_");
          const [data,photo]=await Promise.all([
            fbGet(`userData/${dataKey}`).catch(()=>({})),
            fbGet(`photos/${dataKey}`).catch(()=>null),
          ]);
          const d=data||{};
          const allWeights=d.weights||{};
          const totalKg=Object.values(allWeights).reduce((sum,arr)=>{
            if(!Array.isArray(arr)) return sum;
            return sum+arr.reduce((s,w)=>s+(w.kg||0),0);
          },0);
          const totalEx=Object.values(d.checked||{}).filter(Boolean).length;
          // Max personal record (highest single kg logged)
          const maxPR=Object.values(allWeights).reduce((max,arr)=>{
            if(!Array.isArray(arr)) return max;
            const top=Math.max(...arr.map(w=>w.kg||0));
            return top>max?top:max;
          },0);
          const raidData=await fbGet(`raidCounts/${dataKey}`).catch(()=>null);
          const raids=raidData?.raids||JSON.parse(localStorage.getItem(`rku_raids_${email}`)||"0");
          return{
            email, name:u.name||"Jugador",
            photo:photo||localStorage.getItem(`rku_photo_${email}`)||null,
            playerClass:d.playerClass||null,
            totalXp:d.totalXp||0,
            totalKg:Math.round(totalKg),
            totalEx, maxPR, raids,
            level:getLevel(d.totalXp||0),
          };
        }));
        const users2=await fbGet("users").catch(()=>({}));
        const testEmails=new Set(Object.values(users2||{}).filter(u=>u.isTest).map(u=>u.email));
        setPlayers(list.filter(p=>p.name&&!testEmails.has(p.email)));
      }catch(e){console.log("Ranking error:",e);}
      setLoading(false);
    };
    load();
  },[]);

  const sorted=[...players].sort((a,b)=>{
    if(cat==="xp") return b.totalXp-a.totalXp;
    if(cat==="kg") return b.totalKg-a.totalKg;
    if(cat==="ejercicios") return b.totalEx-a.totalEx;
    if(cat==="pr") return b.maxPR-a.maxPR;
    if(cat==="raids") return (b.raids||0)-(a.raids||0);
    return 0;
  });

  const medals=["🥇","🥈","🥉"];
  const cats=[
    {id:"xp",       label:"⚡ XP Total",    val:p=>`${p.totalXp.toLocaleString()} XP`},
    {id:"kg",       label:"🏋️ Kilos",       val:p=>`${p.totalKg.toLocaleString()} kg`},
    {id:"ejercicios",label:"✅ Ejercicios", val:p=>`${p.totalEx} ejs`},
    {id:"pr",       label:"🏆 Récord",       val:p=>p.maxPR>0?`${p.maxPR} kg`:"— kg"},
    {id:"raids",    label:"⚔️ Raids",        val:p=>`${p.raids||0} raids`},
  ];

  return(
    <div style={{paddingBottom:20}}>
      <div style={{fontSize:9,color:"#F59E0B",letterSpacing:4,marginBottom:14}}>🏅 RANKING GLOBAL</div>

      {/* Category selector */}
      <div style={{marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6}}>
          {cats.slice(0,3).map(c=>(
            <button key={c.id} onClick={()=>setCat(c.id)}
              style={{padding:"10px 8px",borderRadius:10,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",letterSpacing:1,
                background:cat===c.id?"#F59E0B22":"#0D0D1A",
                border:`1px solid ${cat===c.id?"#F59E0B":"#1E1E32"}`,
                color:cat===c.id?"#F59E0B":"#555"}}>
              {c.label}
            </button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,width:"calc(66.6% + 4px)",margin:"0 auto"}}>
          {cats.slice(3).map(c=>(
            <button key={c.id} onClick={()=>setCat(c.id)}
              style={{padding:"10px 8px",borderRadius:10,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",letterSpacing:1,
                background:cat===c.id?"#F59E0B22":"#0D0D1A",
                border:`1px solid ${cat===c.id?"#F59E0B":"#1E1E32"}`,
                color:cat===c.id?"#F59E0B":"#555"}}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading?(
        <div style={{textAlign:"center",padding:40,color:"#555"}}>
          <div style={{fontSize:24,marginBottom:8}}>⏳</div>
          <div style={{fontSize:12}}>Cargando ranking...</div>
        </div>
      ):(
        <div>
          {sorted.map((p,i)=>{
            const isMe=p.email===currentEmail;
            const ri=getRank(p.level)||{color:"#9CA3AF",rank:"E",title:"Novato"};
            const cls=CLASSES.find(c=>c.id===p.playerClass);
            const val=cats.find(c=>c.id===cat)?.val(p);
            return(
              <div key={p.email} style={{
                display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                marginBottom:8,borderRadius:12,
                background:isMe?"#F59E0B14":"#0D0D1A",
                border:`1px solid ${isMe?"#F59E0B66":i<3?"#F59E0B22":"#1E1E32"}`,
                boxShadow:isMe?"0 0 16px #F59E0B22":i===0?"0 0 12px #F59E0B11":"none"
              }}>
                {/* Position */}
                <div style={{width:28,textAlign:"center",fontSize:i<3?20:14,fontWeight:700,color:i<3?"#F59E0B":"#444",fontFamily:"'Cinzel',serif",flexShrink:0}}>
                  {i<3?medals[i]:i+1}
                </div>
                {/* Avatar */}
                <div style={{width:40,height:40,borderRadius:11,border:`2px solid ${ri.color}`,background:`${ri.color}22`,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,color:ri.color,fontFamily:"'Cinzel',serif"}}>
                  {p.photo?<img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:cls?cls.icon:ri.rank}
                </div>
                {/* Info */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:14,fontWeight:700,color:isMe?"#F59E0B":"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{p.name}</span>
                    {isMe&&<span style={{fontSize:9,color:"#F59E0B",background:"#F59E0B22",padding:"1px 6px",borderRadius:10,letterSpacing:1}}>TÚ</span>}
                  </div>
                  <div style={{fontSize:10,color:"#555"}}>Lv.{p.level} · [{ri.rank}] {ri.title}{cls?` · ${cls.icon} ${cls.name}`:""}</div>
                </div>
                {/* Value */}
                <div style={{fontSize:14,fontWeight:700,color:i===0?"#F59E0B":i===1?"#9CA3AF":i===2?"#CD7F32":ri.color,fontFamily:"'Rajdhani',sans-serif",textAlign:"right",flexShrink:0}}>
                  {val}
                </div>
              </div>
            );
          })}
          {sorted.length===0&&(
            <div style={{textAlign:"center",padding:40,color:"#333"}}>
              <div style={{fontSize:32,marginBottom:8}}>🏅</div>
              <div style={{fontSize:14,color:"#444"}}>Aún no hay jugadores en el ranking</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankUpApp({user,onLogout}){
  const saved=getUserData(user.email)||defaultData();
  const [totalXp,setTotalXp]=useState(saved.totalXp||0);
  const [coins,setCoins]=useState(saved.coins||0);
  const [checked,setChecked]=useState(saved.checked||{});
  const [weights,setWeights]=useState(saved.weights||{});
  const [pr,setPR]=useState(saved.personalRecords||{});
  const [earnedAchs,setEarned]=useState(saved.earnedAchs||[]);
  const [redeemed,setRedeemed]=useState(saved.redeemedRewards||[]);
  const [dc,setDC]=useState(saved.dungeonCoins||{});
  const [routines,setRoutines]=useState([]);
  const [assignedDiets,setAssignedDiets]=useState(saved.assignedDiets||[]);
  const [assignedProgram,setAssignedProgram]=useState(saved.assignedProgram||null);
  const [playerClass,setPlayerClass]=useState(saved.playerClass||null);
  const [exNotes,setExNotes]=useState(saved.exNotes||{});  // {key: "texto"}
  const [exHistory,setExHistory]=useState(saved.exHistory||{});  // {exName: [{kg,date,session}]}
  const [activeRaid,setActiveRaid]=useState(saved.activeRaid||null); // {raid, startTime, done}
  const [raidModal,setRaidModal]=useState(false);
  const [raidComplete,setRaidComplete]=useState(null);
  const [raidDefeated,setRaidDefeated]=useState(null); // raid that expired undefeated
  const [messages,setMessages]=useState([]);               // [{id,from,text,date,read}]
  const [showClassModal,setShowClassModal]=useState(!saved.playerClass);
  const cls=CLASSES.find(c=>c.id===playerClass)||null;
  const [activePhase,setActivePhase]=useState(0);
  const [tab,setTab]=useState("misiones");
  const [openDay,setOpenDay]=useState(null);
  const [openChart,setOpenChart]=useState(null);
  const [bodyView,setBodyView]=useState("front");
  const [wInputs,setWInputs]=useState({});
  const [particles,setParticles]=useState([]);
  const [lvlModal,setLvlModal]=useState(null);
  const [redeemModal,setRedeemModal]=useState(null);
  const [achToast,setAchToast]=useState(null);
  const [coinToast,setCoinToast]=useState(null);
  const [showProfile,setShowProfile]=useState(false);
  const prevLvl=useRef(getLevel(totalXp));
  const ph=PHASES[activePhase];
  const level=getLevel(totalXp),xpInLvl=getXpInLevel(totalXp),ri=getRank(level);

  const dataLoaded = useRef(false);

  useEffect(()=>{
    const loadData=async()=>{
      // Sync from Firebase first to get latest data
      await syncFromFirebase(user.email).catch(()=>{});
      const fresh=getUserData(user.email)||{};
      // Load ALL data from Firebase into state
      if(fresh.totalXp>0) setTotalXp(fresh.totalXp);
      if(fresh.checked&&Object.keys(fresh.checked).length>0) setChecked(fresh.checked);
      if(fresh.weights&&Object.keys(fresh.weights).length>0) setWeights(fresh.weights);
      if(fresh.personalRecords&&Object.keys(fresh.personalRecords).length>0) setPR(fresh.personalRecords);
      if(fresh.earnedAchs?.length>0) setEarned(fresh.earnedAchs);
      if(fresh.redeemedRewards?.length>0) setRedeemed(fresh.redeemedRewards);
      const freshDC=fresh.dungeonCoins||{};
      if(Object.keys(freshDC).length>0) setDC(freshDC);
      // Load coins: if Firebase has a value >0 respect it always.
      // Only recalculate if coins===0 AND dungeonCoins exists (sign of corruption).
      const storedCoins=fresh.coins||0;
      if(storedCoins>0){
        setCoins(storedCoins);
      } else if(Object.keys(freshDC).length>0){
        // Coins corrupted to 0 — recover by counting dungeonCoins keys
        // Use fixed base values to avoid retroactive inflation from price changes
        const BASE_DUNGEON=75, BASE_WEEK=150, BASE_PHASE=500;
        let c=0;
        Object.keys(freshDC).forEach(k=>{
          if(k.startsWith("phase_")) c+=BASE_PHASE;
          else if(k.startsWith("week_")) c+=BASE_WEEK;
          else c+=BASE_DUNGEON;
        });
        const spent=(fresh.redeemedRewards||[]).reduce((a,e)=>a+(typeof e==="object"?e.cost||0:REWARDS.find(r=>r.id===e)?.cost||0),0);
        const recovered=Math.max(0,c-spent);
        if(recovered>0) setCoins(recovered);
      }
      if(fresh.playerClass) setPlayerClass(fresh.playerClass);
      if(fresh.exNotes&&Object.keys(fresh.exNotes).length>0) setExNotes(fresh.exNotes);
      // ── Load / Migrate exHistory ──
      {
        const existingHistory=fresh.exHistory||{};
        const hasHistory=Object.keys(existingHistory).length>0;
        if(hasHistory){
          setExHistory(existingHistory);
        } else if(fresh.weights&&Object.keys(fresh.weights).length>0){
          // Build keyToName map from PHASES + routines
          const keyToName={};
          PHASES.forEach(p=>p.training.forEach((day,di)=>day.exercises.forEach((ex,ei)=>{
            keyToName[`${p.id}_${di}_${ei}`]=ex.name;
          })));
          (fresh.customRoutines||[]).forEach(rt=>rt.sessions?.forEach((s,si)=>s.exercises?.forEach((ex,ei)=>{
            keyToName[`rt_${rt.id}_${si}_${ei}`]=ex.name;
          })));
          const migrated={};
          Object.entries(fresh.weights).forEach(([key,logs])=>{
            const name=keyToName[key];
            if(!name||!Array.isArray(logs)) return;
            if(!migrated[name]) migrated[name]=[];
            logs.forEach(w=>{ if(w.kg>0) migrated[name].push({kg:w.kg,date:null,session:w.session}); });
          });
          if(Object.keys(migrated).length>0) setExHistory(migrated);
        }
      }
      if(fresh.activeRaid) setActiveRaid(fresh.activeRaid);
      // Check raid on app open
      setTimeout(()=>triggerRaidCheck(fresh.activeRaid||null),2000);
      // Load messages from Firebase
      const msgKey=user.email.replace(/\./g,"_").replace(/@/g,"_at_");
      fbGet(`messages/${msgKey}`).then(msgs=>{
        if(msgs) setMessages(Array.isArray(msgs)?msgs:Object.values(msgs));
      }).catch(()=>{});
      if(fresh.assignedDiets?.length>0) setAssignedDiets(fresh.assignedDiets);
      // Migrate old ex.done system → checked keys
      const cleanRoutines=(fresh.customRoutines||[]).filter(r=>r.assignedByAdmin===true);
      if(cleanRoutines.length>0){
        const migratedChecked={...(fresh.checked||{})};
        let needsMigration=false;
        cleanRoutines.forEach(rt=>{
          rt.sessions?.forEach((s,si)=>{
            s.exercises?.forEach((ex,ei)=>{
              if(ex.done===true){
                const key=`rt_${rt.id}_${si}_${ei}`;
                if(!migratedChecked[key]){ migratedChecked[key]=true; needsMigration=true; }
              }
              // Strip ex.done from the object so it's clean going forward
              delete ex.done;
            });
          });
        });
        if(needsMigration){
          setChecked(migratedChecked);
          // Persist migration immediately
          saveUserData(user.email,{...fresh,checked:migratedChecked,customRoutines:cleanRoutines});
        }
        setRoutines(cleanRoutines);
      }
      if(fresh.assignedProgram){
        let changed=false;
        fresh.assignedProgram.phases?.forEach(p=>{
          if(p.mantra?.includes("90 días")){p.mantra=p.mantra.replace(/90 días/g,"el futuro");changed=true;}
        });
        if(changed) saveUserData(user.email,fresh);
        setAssignedProgram(fresh.assignedProgram);
      }
      // Store the raw snapshot so save effect can safely merge during first renders
      loadedRef.current = fresh;
      // Always mark as loaded — safe to auto-save now
      dataLoaded.current = true;
      // 🎂 Birthday coins check
      const u=getUsers()[user.email]||{};
      if(u.birthdate){
        const bd=new Date(u.birthdate);
        const today=new Date();
        const isBirthday=bd.getMonth()===today.getMonth()&&bd.getDate()===today.getDate();
        const lastBirthdayGift=localStorage.getItem(`rku_bday_${user.email}`);
        const thisYear=today.getFullYear().toString();
        if(isBirthday&&lastBirthdayGift!==thisYear){
          const BIRTHDAY_COINS=500;
          setCoins(c=>c+BIRTHDAY_COINS);
          localStorage.setItem(`rku_bday_${user.email}`,thisYear);
          setTimeout(()=>setCoinToast(`🎂 ¡Feliz cumpleaños! +${BIRTHDAY_COINS} monedas de regalo`),800);
        }
      }
    };
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // Track how many setState calls have fired since load, to avoid saving before all are applied
  const loadedRef=useRef(null); // stores the raw Firebase snapshot until all states are settled
  useEffect(()=>{
    if(!dataLoaded.current) return;
    // Always take the MAX between current state and the Firebase snapshot
    // This prevents any race condition from overwriting real progress with empty state
    const base=loadedRef.current||{};
    const safeChecked={...(base.checked||{}),...checked};
    const safeWeights={...(base.weights||{}),...weights};
    const safeDC={...(base.dungeonCoins||{}),...dc};
    const safeEarned=[...new Set([...(base.earnedAchs||[]),...earnedAchs])];
    saveUserData(user.email,{
      totalXp: Math.max(totalXp, base.totalXp||0),
      coins:   Math.max(coins,   base.coins||0),
      checked: safeChecked,
      weights: safeWeights,
      personalRecords:pr,
      earnedAchs: safeEarned,
      redeemedRewards:redeemed,
      dungeonCoins: safeDC,
      customRoutines:routines,
      playerClass,
      assignedDiets,
      assignedProgram,
      exNotes,
      activeRaid,
      exHistory
    });
  },[totalXp,coins,checked,weights,pr,earnedAchs,redeemed,dc,routines,playerClass,assignedProgram,exNotes,activeRaid,exHistory]);
  useEffect(()=>{if(level>prevLvl.current){setLvlModal(level);prevLvl.current=level;}},[level]);
  useEffect(()=>{
    if(!dataLoaded.current) return; // wait until Firebase data is loaded
    const td=Object.values(checked).filter(Boolean).length;
    const twl=Object.values(weights).reduce((a,arr)=>a+(arr||[]).length,0);
    const dc2=PHASES.reduce((t,p)=>t+p.training.filter((d,di)=>d.exercises.every((_,ei)=>checked[exKey(p.id,di,ei)])).length,0);
    const prc=Object.keys(pr).length;
    const p1=PHASES[0].training.every((d,di)=>d.exercises.every((_,ei)=>checked[exKey(1,di,ei)]));
    const p2=PHASES[1].training.every((d,di)=>d.exercises.every((_,ei)=>checked[exKey(2,di,ei)]));
    const p3=PHASES[2].training.every((d,di)=>d.exercises.every((_,ei)=>checked[exKey(3,di,ei)]));
    // Calculate total coins ever earned (current + spent)
    const spent=redeemed.reduce((a,e)=>a+(typeof e==="object"?e.cost||0:REWARDS.find(r=>r.id===e)?.cost||0),0);
    const totalCoinsEarned=coins+spent;
    const raidsComplete=(earnedAchs.filter(a=>a==="first_raid").length>0?1:0)+ // simplified count via saved data
      (JSON.parse(localStorage.getItem(`rku_raids_${user?.email}`)||"0"));
    const legendaryRaids=JSON.parse(localStorage.getItem(`rku_legendary_raids_${user?.email}`)||"0");
    const stats={totalDone:td,totalWeightLogs:twl,daysComplete:dc2,prCount:prc,phase1Complete:p1,phase2Complete:p2,phase3Complete:p3,customRoutines:routines.length,totalCoinsEarned,raidsComplete,legendaryRaids};
    // Use functional setEarned to always read latest list — avoids stale closure bug
    setEarned(currentEarned=>{
      let newEarned=[...currentEarned];
      let xpToAdd=0;
      let lastAch=null;
      ACHIEVEMENTS.forEach(a=>{
        if(!newEarned.includes(a.id)&&a.check(stats)){
          newEarned=[...newEarned,a.id];
          xpToAdd+=a.xp;
          lastAch=a;
        }
      });
      if(xpToAdd>0){
        setTotalXp(p=>p+xpToAdd);
        if(lastAch) setAchToast(lastAch);
      }
      return newEarned;
    });
  },[checked,weights,pr,routines,coins,redeemed]);

  const spawn=useCallback((x,y,t,c)=>{const id=Date.now()+Math.random();setParticles(p=>[...p,{id,x,y,text:t,color:c}]);},[]);
  const addXp=useCallback((amt,evt,label)=>{if(evt){const r=evt.currentTarget?.getBoundingClientRect?.();if(r)spawn(r.left+r.width/2,r.top,label||`+${amt} XP`,ri.color);}setTotalXp(p=>p+amt);},[ri.color,spawn]);
  const addCoins=useCallback((amt,msg)=>{setCoins(p=>p+amt);if(msg)setCoinToast({msg,coins:amt});},[]);

  const triggerRaidCheck=useCallback((currentRaid)=>{
    // If there's an active raid, check if expired
    if(currentRaid&&!currentRaid.done){
      const elapsed=(Date.now()-currentRaid.startTime)/1000;
      if(elapsed>currentRaid.raid.time){
        setActiveRaid(null);
        setRaidDefeated(currentRaid.raid); // show defeat screen
        return;
      }
      setRaidModal(true); // show existing raid
      return;
    }
    if(currentRaid?.done) setActiveRaid(null);
    // Cooldown: check Firebase for last raid time
    const raidCoolKey=(user?.email||"").replace(/\./g,"_").replace(/@/g,"_at_");
    fbGet(`raidCooldown/${raidCoolKey}`).then(cd=>{
      const lastRaidAt=cd?.lastRaidAt||0;
      const hoursSince=(Date.now()-lastRaidAt)/3600000;
      if(hoursSince<20) return; // 20h cooldown between raids
      if(Math.random()<RAID_TRIGGER_CHANCE){
        const raid=RAID_DB[Math.floor(Math.random()*RAID_DB.length)];
        const newRaid={raid,startTime:Date.now(),done:false};
        setActiveRaid(newRaid);
        setTimeout(()=>setRaidModal(true),800);
      }
    }).catch(()=>{});
  },[]);

  const completeRaid=useCallback(()=>{
    if(!activeRaid||activeRaid.done) return;
    const {raid}=activeRaid;
    addXp(raid.xp,null,`+${raid.xp} XP ⚔️ RAID`);
    addCoins(raid.coins,`🏴‍☠️ Raid completada: ${raid.boss}`);
    setActiveRaid(p=>({...p,done:true,completedAt:Date.now()}));
    const raidKey=user.email.replace(/\./g,"_").replace(/@/g,"_at_");
    fbSet(`raidCooldown/${raidKey}`,{lastRaidAt:Date.now()}).catch(()=>{});
    // Track raid count in localStorage AND Firebase
    const raidCount=JSON.parse(localStorage.getItem(`rku_raids_${user.email}`)||"0")+1;
    localStorage.setItem(`rku_raids_${user.email}`,JSON.stringify(raidCount));
    if(raid.rarity==="legendaria"){
      const legCount=JSON.parse(localStorage.getItem(`rku_legendary_raids_${user.email}`)||"0")+1;
      localStorage.setItem(`rku_legendary_raids_${user.email}`,JSON.stringify(legCount));
    }
    // Persist raid count to Firebase via saveUserData on next auto-save
    // We store it in a raidCount field so ranking can read it
    const msgKey=user.email.replace(/\./g,"_").replace(/@/g,"_at_");
    fbSet(`raidCounts/${msgKey}`,{email:user.email,raids:raidCount}).catch(()=>{});
    setRaidModal(false);
    setTimeout(()=>setRaidComplete(raid),300);
    // Achievement check via earned
    setEarned(p=>p.includes("first_raid")?p:[...p,"first_raid"]);
  },[activeRaid,addXp,addCoins]);

  const dismissRaid=useCallback(()=>setRaidModal(false),[]);
  const skipRaid=useCallback(()=>{
    if(!activeRaid) return;
    setRaidDefeated(activeRaid.raid);
    setActiveRaid(null);
    setRaidModal(false);
    const raidKeyS=user.email.replace(/\./g,"_").replace(/@/g,"_at_");
    fbSet(`raidCooldown/${raidKeyS}`,{lastRaidAt:Date.now()}).catch(()=>{});
  },[activeRaid,user]);

  const sendMessage=useCallback(async(text)=>{
    if(!text.trim()) return;
    const msgKey=user.email.replace(/\./g,"_").replace(/@/g,"_at_");
    const msg={id:Date.now(),from:"user",name:user.name,text:text.trim(),date:new Date().toISOString(),read:false};
    const updated=[...messages,msg];
    setMessages(updated);
    await fbSet(`messages/${msgKey}`,updated).catch(()=>{});
  },[messages,user]);

  const markMessagesRead=useCallback(async()=>{
    const msgKey=user.email.replace(/\./g,"_").replace(/@/g,"_at_");
    const updated=messages.map(m=>m.from==="admin"?{...m,read:true}:m);
    setMessages(updated);
    await fbSet(`messages/${msgKey}`,updated).catch(()=>{});
  },[messages,user]);

  const unreadFromAdmin=messages.filter(m=>m.from==="admin"&&!m.read).length;

  const [dungeonComplete,setDungeonComplete]=useState(null); // {dayName, totalKg, exercises, coins}

  const toggleEx=useCallback((key,xp,phaseId,dayIdx,evt,exName)=>{
    const was=!!checked[key];const nc={...checked,[key]:!was};setChecked(nc);
    if(!was){
      const mult=getClassMultiplier(playerClass,exName||"",xp);
      const finalXp=Math.round(xp*mult);
      const label=mult>1?`+${finalXp} XP ×${mult}`:null;
      addXp(finalXp,evt,label);
      const phase=PHASES.find(p=>p.id===phaseId);const day=phase?.training[dayIdx];
      if(day){
        // ── PROGRAM dungeon reward ──
        const ck=`${phaseId}_${dayIdx}`;
        const allDone=day.exercises.every((_,ei)=>nc[exKey(phaseId,dayIdx,ei)]);
        if(allDone){
          setDC(prevDC=>{
            if(prevDC[ck]) return prevDC;
            const bossDone=day.exercises.filter((ex,ei)=>ex.boss&&nc[exKey(phaseId,dayIdx,ei)]).length;
            const dungeonCoins=COIN_DUNGEON+bossDone*COIN_BOSS_EX;
            addCoins(dungeonCoins,"¡Dungeon completado!");
            const sessKg=day.exercises.reduce((sum,ex,ei)=>{
              const wArr=weights[exKey(phaseId,dayIdx,ei)]||[];
              return sum+wArr.reduce((s,w)=>s+(w.kg||0),0);
            },0);
            setTimeout(()=>setDungeonComplete({
              dayName:day.day, totalKg:Math.round(sessKg),
              exercises:day.exercises.length, coins:dungeonCoins, bossDone
            }),400);
            // Roll for raid after dungeon complete
            setTimeout(()=>triggerRaidCheck(null),2500);
            const newDC={...prevDC,[ck]:true};
            const wk=`week_${phaseId}_${day.week}`;
            if(!newDC[wk]){
              const wd=phase.training.filter(d=>d.week===day.week);
              const awDone=wd.every(d=>{const gi=phase.training.indexOf(d);return d.exercises.every((_,ei)=>nc[exKey(phaseId,gi,ei)]);});
              if(awDone){newDC[wk]=true;addCoins(COIN_WEEK,`🗓️ Semana ${day.week} completada`);}
            }
            const pk=`phase_${phaseId}`;
            if(!newDC[pk]){
              const apDone=phase.training.every((d,di2)=>d.exercises.every((_,ei)=>nc[exKey(phaseId,di2,ei)]));
              if(apDone){newDC[pk]=true;addCoins(COIN_PHASE,`⚡ ¡FASE ${phaseId} COMPLETADA!`);}
            }
            return newDC;
          });
        }
      } else if(!phaseId){
        // ── ROUTINE dungeon reward ──
        // key format: rt_{rtId}_{si}_{ei} — extract rtId and si
        const parts=key.split("_"); // ["rt","rtId","si","ei"]
        if(parts[0]==="rt"){
          const rtId=parts[1];const si=parseInt(parts[2]);
          const rt=routines.find(r=>r.id===rtId);
          const sess=rt?.sessions?.[si];
          if(sess){
            const ck=`rt_${rtId}_done_${si}`;
            const allDone=sess.exercises.every((_,ei)=>nc[`rt_${rtId}_${si}_${ei}`]);
            if(allDone){
              setDC(prevDC=>{
                if(prevDC[ck]) return prevDC;
                const bossDone=sess.exercises.filter((ex,ei)=>ex.boss&&nc[`rt_${rtId}_${si}_${ei}`]).length;
                const dungeonCoins=COIN_DUNGEON+bossDone*COIN_BOSS_EX;
                addCoins(dungeonCoins,"¡Dungeon completado!");
                const sessKg=sess.exercises.reduce((sum,ex,ei)=>{
                  const wArr=weights[`rt_${rtId}_${si}_${ei}`]||[];
                  return sum+wArr.reduce((s,w)=>s+(w.kg||0),0);
                },0);
                setTimeout(()=>setDungeonComplete({
                  dayName:sess.day, totalKg:Math.round(sessKg),
                  exercises:sess.exercises.length, coins:dungeonCoins, bossDone
                }),400);
                setTimeout(()=>triggerRaidCheck(null),2500);
                return {...prevDC,[ck]:true};
              });
            }
          }
        }
      }
    } else setTotalXp(p=>Math.max(0,p-xp));
  },[checked,dc,addXp,addCoins,weights,routines]);

  const logWeight=useCallback((key,evt,exName)=>{
    const kg=parseFloat(wInputs[key]);if(isNaN(kg)||kg<=0)return;
    const arr=weights[key]||[];const prevMax=arr.length>0?Math.max(...arr.map(w=>w.kg)):0;
    const isRec=kg>0&&kg>prevMax&&arr.length>0;
    const dateStr=new Date().toISOString();
    setWeights(p=>({...p,[key]:[...arr,{session:`S${arr.length+1}`,kg}]}));
    // Also write to global exercise history
    if(exName){
      setExHistory(p=>{
        const hist=p[exName]||[];
        return {...p,[exName]:[...hist,{kg,date:dateStr,session:`S${hist.length+1}`}]};
      });
    }
    setWInputs(p=>({...p,[key]:""}));
    if(isRec){setPR(p=>({...p,[key]:kg}));const recMult=getClassMultiplier(playerClass,"",80,true);const recXp=Math.round(80*recMult);addXp(recXp,evt,recMult>1?`+${recXp} XP ×${recMult} 🏆`:null);}else addXp(15,evt);
  },[weights,wInputs,addXp,exHistory]);

  const deleteWeight=useCallback((key,idx)=>{
    setWeights(p=>{
      const arr=[...(p[key]||[])];
      arr.splice(idx,1);
      // Renumber sessions
      const renumbered=arr.map((w,i)=>({...w,session:`S${i+1}`}));
      // Recalculate PR
      const newMax=renumbered.length>0?Math.max(...renumbered.map(w=>w.kg)):0;
      setPR(pp=>({...pp,[key]:newMax||undefined}));
      return {...p,[key]:renumbered};
    });
  },[]);

  const redeemReward=useCallback((reward)=>{
    if(coins<reward.cost)return;
    const entry={id:reward.id,name:reward.name,icon:reward.icon,cost:reward.cost,date:new Date().toISOString()};
    setCoins(p=>p-reward.cost);
    setRedeemed(p=>[...p,entry]);
    setRedeemModal({reward,newCoins:coins-reward.cost});
  },[coins]);

  // Get user sex from users store
  const userSex=(getUsers()[user.email]||{}).sex||"M";
  // Muscle XP
  const mxp={};Object.keys(MUSCLE_DEFS).forEach(m=>mxp[m]=0);
  PHASES.forEach(p=>p.training.forEach((day,di)=>day.exercises.forEach((ex,ei)=>{
    if(checked[exKey(p.id,di,ei)]){const ms=MUSCLE_MAP[ex.name]||EXERCISE_DB.find(e=>e.name===ex.name)?.muscle||[];ms.forEach(m=>{if(mxp[m]!==undefined)mxp[m]+=ex.xp;});}
  })));
  routines.forEach(rt=>rt.sessions?.forEach((s,si)=>s.exercises?.forEach((ex,ei)=>{
    const key=`rt_${rt.id}_${si}_${ei}`;
    if(checked[key]){const ms=MUSCLE_MAP[ex.name]||EXERCISE_DB.find(e=>e.name===ex.name)?.muscle||[];ms.forEach(m=>{if(mxp[m]!==undefined)mxp[m]+=(ex.xp||30);});}
  })));

  const phTotal=ph.training.reduce((a,d)=>a+d.exercises.length,0);
  const phDone=ph.training.reduce((a,d,di)=>a+d.exercises.filter((_,ei)=>checked[exKey(ph.id,di,ei)]).length,0);
  const phXpT=ph.training.reduce((a,d)=>a+d.exercises.reduce((b,ex)=>b+ex.xp,0),0);
  const phXpE=ph.training.reduce((a,d,di)=>a+d.exercises.reduce((b,ex,ei)=>b+(checked[exKey(ph.id,di,ei)]?ex.xp:0),0),0);
  const xpPct=Math.min((xpInLvl/XP_PER_LEVEL)*100,100);
  const TABS=[{id:"misiones",l:"⚔️"},{id:"nutricion",l:"🍖"},{id:"cuerpo",l:"🫀"},{id:"tienda",l:"🪙"},{id:"logros",l:"🏆"},{id:"ranking",l:"🏅"},{id:"buzon",l:"✉️"}];

  return(
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"#07070F",color:"#E8E6FF",fontFamily:"'Rajdhani','Segoe UI',sans-serif",overflow:"hidden"}}>
      <style>{CSS}</style>
      {particles.map(p=><Particle key={p.id} x={p.x} y={p.y} text={p.text} color={p.color} onDone={()=>setParticles(prev=>prev.filter(x=>x.id!==p.id))}/>)}
      {lvlModal&&<LevelUpModal level={lvlModal} onClose={()=>setLvlModal(null)}/>}
      {/* DUNGEON COMPLETE MODAL */}
      {/* ── RAID MODAL ── */}
      {raidModal&&activeRaid&&!activeRaid.done&&<RaidModal raid={activeRaid.raid} startTime={activeRaid.startTime} onComplete={completeRaid} onDismiss={dismissRaid} onSkip={skipRaid}/>}

      {/* ── RAID COMPLETE MODAL ── */}
      {raidComplete&&(
        <div style={{position:"fixed",inset:0,background:"#000000EE",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setRaidComplete(null)}>
          <div style={{width:"100%",maxWidth:340,background:"#07070F",borderRadius:20,border:`2px solid ${RAID_RARITY_COLOR[raidComplete.rarity]}`,padding:"32px 24px",textAlign:"center",boxShadow:`0 0 60px ${RAID_RARITY_COLOR[raidComplete.rarity]}88`}}>
            <div style={{fontSize:64,marginBottom:8}}>{raidComplete.icon}</div>
            <div style={{fontSize:9,letterSpacing:4,color:RAID_RARITY_COLOR[raidComplete.rarity],marginBottom:6}}>RAID DERROTADA</div>
            <div style={{fontSize:20,fontWeight:900,color:"#FFF",fontFamily:"'Cinzel',serif",marginBottom:16}}>{raidComplete.boss}</div>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:20}}>
              <div style={{padding:"10px 20px",background:"#A78BFA22",border:"1px solid #A78BFA44",borderRadius:10}}>
                <div style={{fontSize:18,fontWeight:900,color:"#A78BFA",fontFamily:"'Rajdhani',sans-serif"}}>+{raidComplete.xp} XP</div>
              </div>
              <div style={{padding:"10px 20px",background:"#F59E0B22",border:"1px solid #F59E0B44",borderRadius:10}}>
                <div style={{fontSize:18,fontWeight:900,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif"}}>+{raidComplete.coins} 🪙</div>
              </div>
            </div>
            <button onClick={()=>setRaidComplete(null)}
              style={{padding:"12px 32px",background:`linear-gradient(135deg,${RAID_RARITY_COLOR[raidComplete.rarity]},${RAID_RARITY_COLOR[raidComplete.rarity]}AA)`,border:"none",borderRadius:12,color:"#07070F",fontSize:13,fontWeight:900,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>
              ¡VICTORIA!
            </button>
          </div>
        </div>
      )}

      {/* ── RAID DEFEATED MODAL ── */}
      {raidDefeated&&(
        <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,
          background:"radial-gradient(ellipse at center,#1a0000 0%,#000000 80%)"}}
          onClick={()=>setRaidDefeated(null)}>
          <div style={{width:"100%",maxWidth:340,textAlign:"center"}}>
            {/* Boss icon — desaturated red */}
            <div style={{fontSize:80,marginBottom:16,filter:"grayscale(60%) drop-shadow(0 0 30px #E84A5F)"}}>
              {raidDefeated.icon}
            </div>
            {/* YOU DIED style */}
            <div style={{fontSize:42,fontWeight:900,color:"#E84A5F",fontFamily:"'Cinzel',serif",
              letterSpacing:6,textShadow:"0 0 40px #E84A5F88",marginBottom:8,
              animation:"bossGlow 2s ease-in-out infinite"}}>
              DERROTADO
            </div>
            <div style={{width:200,height:1,background:"linear-gradient(90deg,transparent,#E84A5F,transparent)",margin:"0 auto 16px"}}/>
            <div style={{fontSize:15,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif",marginBottom:12}}>
              {raidDefeated.boss}
            </div>
            <div style={{fontSize:13,color:"#666",fontStyle:"italic",marginBottom:32,fontFamily:"'Rajdhani',sans-serif"}}>
              "Ha consumido tu alma."
            </div>
            <button onClick={()=>setRaidDefeated(null)}
              style={{padding:"12px 40px",background:"transparent",border:"1px solid #E84A5F55",
                borderRadius:12,color:"#E84A5F",fontSize:11,cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif",letterSpacing:4}}>
              CONTINUAR
            </button>
          </div>
        </div>
      )}

      {dungeonComplete&&(()=>{
        const kg=dungeonComplete.totalKg;
        const comparisons=[
          {min:0,   max:10,   emoji:"🐀", name:"una rata de mazmorra",    title:"NOVATO DE MAZMORRA"},
          {min:10,  max:30,   emoji:"🐺", name:"un lobo del bosque",       title:"CAZADOR DEL BOSQUE"},
          {min:30,  max:60,   emoji:"🐗", name:"un jabalí salvaje",        title:"BESTIA SALVAJE"},
          {min:60,  max:100,  emoji:"🦁", name:"un león de combate",       title:"GUERRERO FELINO"},
          {min:100, max:200,  emoji:"🐉", name:"un dragón joven",          title:"DOMADOR DE DRAGONES"},
          {min:200, max:350,  emoji:"🦣", name:"un mamut de guerra",       title:"COLOSO DE HIELO"},
          {min:350, max:600,  emoji:"🗿", name:"un gólem de piedra",       title:"TITÁN DE PIEDRA"},
          {min:600, max:1000, emoji:"🐋", name:"una ballena legendaria",   title:"LEVIATÁN"},
          {min:1000,max:2000, emoji:"🌋", name:"un volcán en erupción",    title:"FUERZA PRIMORDIAL"},
          {min:2000,max:99999,emoji:"⭐", name:"una estrella enana",       title:"SEMIDIÓS"},
        ];
        const comp=kg>0?(comparisons.find(c=>kg>=c.min&&kg<c.max)||comparisons[comparisons.length-1]):null;

        return(
          <div style={{position:"fixed",inset:0,zIndex:9999,background:"#03020A",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,overflow:"hidden"}}>
            {/* Animated background */}
            <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 0%,#A78BFA22 0%,transparent 70%)",pointerEvents:"none"}}/>
            <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 100%,#F59E0B11 0%,transparent 70%)",pointerEvents:"none"}}/>

            {/* Stars */}
            {Array.from({length:30}).map((_,i)=>(
              <div key={i} style={{position:"absolute",left:`${Math.random()*100}%`,top:`${Math.random()*100}%`,width:2,height:2,borderRadius:"50%",background:"#FFF",opacity:Math.random()*0.6+0.1}}/>
            ))}

            {/* Header */}
            <div style={{fontSize:9,color:"#A78BFA",letterSpacing:8,marginBottom:6,textShadow:"0 0 20px #A78BFA"}}>✦ MISIÓN COMPLETADA ✦</div>
            <div style={{fontSize:26,fontWeight:900,color:"#FFF",fontFamily:"'Cinzel',serif",marginBottom:4,textAlign:"center",textShadow:"0 0 30px #A78BFA88"}}>{dungeonComplete.dayName}</div>
            <div style={{fontSize:11,color:"#A78BFA",letterSpacing:3,marginBottom:24}}>⚔️ DUNGEON CONQUISTADO ⚔️</div>

            {/* Main reward card */}
            <div style={{width:"100%",maxWidth:320,background:"linear-gradient(135deg,#0D0A1F,#0A0A14)",border:"1px solid #A78BFA44",borderRadius:20,padding:20,marginBottom:16,position:"relative",overflow:"hidden",boxShadow:"0 0 40px #A78BFA22"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#A78BFA,#F59E0B,#A78BFA,transparent)"}}/>

              {/* Kg comparison */}
              {comp?(
                <div style={{textAlign:"center",marginBottom:16}}>
                  <div style={{fontSize:64,marginBottom:4,filter:"drop-shadow(0 0 20px #F59E0B)"}}>{comp.emoji}</div>
                  <div style={{fontSize:10,color:"#F59E0B",letterSpacing:4,marginBottom:4}}>{comp.title}</div>
                  <div style={{fontSize:36,fontWeight:900,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",lineHeight:1}}>{kg.toLocaleString()}<span style={{fontSize:16,color:"#A78BFA"}}> kg</span></div>
                  <div style={{fontSize:12,color:"#888",marginTop:4}}>Equivale a levantar <span style={{color:"#F59E0B",fontWeight:700}}>{comp.name}</span></div>
                </div>
              ):(
                <div style={{textAlign:"center",marginBottom:16}}>
                  <div style={{fontSize:48,marginBottom:8}}>⚔️</div>
                  <div style={{fontSize:14,color:"#AAA"}}>¡Registra tus pesos para ver</div>
                  <div style={{fontSize:14,color:"#A78BFA",fontWeight:700}}>cuánto levantas!</div>
                </div>
              )}

              {/* Divider */}
              <div style={{height:1,background:"linear-gradient(90deg,transparent,#A78BFA44,transparent)",marginBottom:14}}/>

              {/* Stats row */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{textAlign:"center",background:"#F59E0B0D",borderRadius:10,padding:"10px 6px",border:"1px solid #F59E0B22"}}>
                  <div style={{fontSize:9,color:"#F59E0B",letterSpacing:3,marginBottom:2}}>EJERCICIOS</div>
                  <div style={{fontSize:24,fontWeight:900,color:"#F59E0B",fontFamily:"'Cinzel',serif"}}>{dungeonComplete.exercises}</div>
                  <div style={{fontSize:9,color:"#555"}}>completados</div>
                </div>
                <div style={{textAlign:"center",background:"#34D3990D",borderRadius:10,padding:"10px 6px",border:"1px solid #34D39922"}}>
                  <div style={{fontSize:9,color:"#34D399",letterSpacing:3,marginBottom:2}}>RECOMPENSA</div>
                  <div style={{fontSize:24,fontWeight:900,color:"#34D399",fontFamily:"'Cinzel',serif"}}>+{dungeonComplete.coins}</div>
                  <div style={{fontSize:9,color:"#555"}}>🪙 monedas</div>
                </div>
              </div>
            </div>

            {/* Boss badge */}
            {dungeonComplete.bossDone>0&&(
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 20px",background:"linear-gradient(135deg,#F59E0B22,#EF444422)",border:"1px solid #F59E0B66",borderRadius:12,marginBottom:16,boxShadow:"0 0 20px #F59E0B22"}}>
                <span style={{fontSize:20}}>💀</span>
                <div>
                  <div style={{fontSize:11,color:"#F59E0B",fontWeight:700,letterSpacing:2}}>JEFE DERROTADO</div>
                  <div style={{fontSize:10,color:"#888"}}>{dungeonComplete.bossDone} boss{dungeonComplete.bossDone>1?"es":""} eliminado{dungeonComplete.bossDone>1?"s":""}</div>
                </div>
                <span style={{fontSize:20}}>💀</span>
              </div>
            )}

            {/* Continue button */}
            <button onClick={()=>setDungeonComplete(null)}
              style={{padding:"16px 48px",background:"linear-gradient(135deg,#7C3AED,#A78BFA,#7C3AED)",border:"none",borderRadius:14,color:"#FFF",fontSize:16,fontWeight:900,cursor:"pointer",fontFamily:"'Cinzel',serif",letterSpacing:3,boxShadow:"0 0 30px #A78BFA66",backgroundSize:"200%"}}>
              ⚔ CONTINUAR ⚔
            </button>
            <div style={{fontSize:10,color:"#333",marginTop:10,letterSpacing:2}}>TU LEYENDA CRECE</div>
          </div>
        );
      })()}
      {redeemModal&&<RedeemModal reward={redeemModal.reward} coins={redeemModal.newCoins} onClose={()=>setRedeemModal(null)}/>}
      {showClassModal&&<ClassSelectModal current={playerClass} onSelect={id=>{setPlayerClass(id);setShowClassModal(false);}}/>}
      {achToast&&<AchToast ach={achToast} onDone={()=>setAchToast(null)}/>}
      {coinToast&&<CoinToast msg={coinToast.msg} coins={coinToast.coins} onDone={()=>setCoinToast(null)}/>}

      {/* Profile drawer */}
      {showProfile&&(
        <div onClick={()=>setShowProfile(false)} style={{position:"fixed",inset:0,zIndex:9990,background:"rgba(0,0,0,.75)",backdropFilter:"blur(6px)"}}>
          <div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:0,right:0,width:260,height:"100%",background:"#0D0D1A",borderLeft:"1px solid #A78BFA33",padding:28,display:"flex",flexDirection:"column",gap:14}}>
            <div style={{fontSize:9,letterSpacing:5,color:"#444",marginBottom:4}}>PERFIL RANKUP</div>
            <ProfileAvatar userEmail={user.email} riColor={ri.color} clsIcon={cls?cls.icon:"🗡️"}/>
            <div><div style={{fontSize:20,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif"}}>{user.name}</div><div style={{fontSize:11,color:"#555",marginTop:2}}>{user.email}</div></div>
            {cls&&(
              <div style={{background:`${cls.color}18`,border:`1px solid ${cls.color}44`,borderRadius:10,padding:"10px 12px"}}>
                <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:4}}>CLASE</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:20}}>{cls.icon}</span>
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:cls.color,fontFamily:"'Cinzel',serif"}}>{cls.name}</div>
                    <div style={{fontSize:10,color:"#666"}}>{cls.goal}</div>
                  </div>
                </div>
                <div style={{fontSize:10,color:cls.color,marginTop:6,opacity:.8}}>🎯 {cls.bonus}</div>
              </div>
            )}
            {[{l:"Nivel",v:level},{l:"Rango",v:`[${ri.rank}] ${ri.title}`},{l:"XP Total",v:totalXp.toLocaleString()},{l:"Monedas",v:`🪙 ${coins}`}].map(s=>(
              <div key={s.l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1A1A2E"}}>
                <span style={{fontSize:12,color:"#555"}}>{s.l}</span>
                <span style={{fontSize:12,color:ri.color,fontWeight:700}}>{s.v}</span>
              </div>
            ))}

            {/* IMC + Weight update */}
            <ProfileFisico userEmail={user.email}/>
            <button onClick={()=>{setShowProfile(false);setShowClassModal(true);}} style={{width:"100%",padding:10,background:"#0D0D1A",border:"1px solid #A78BFA44",borderRadius:10,color:"#A78BFA",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>⚔️ CAMBIAR CLASE</button>
            <div style={{flex:1}}/>
            <button onClick={onLogout} style={{width:"100%",padding:12,background:"#1A1A2E",border:"1px solid #E84A5F44",borderRadius:10,color:"#E84A5F",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>CERRAR SESIÓN</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{flexShrink:0,background:"linear-gradient(180deg,#0D0D1F,#07070F)",padding:"14px 16px 12px",position:"relative",overflow:"hidden",borderBottom:`1px solid ${ri.color}44`}}>
        <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",opacity:.025}}><div style={{width:"100%",height:2,background:"#FFF",animation:"scanline 4s linear infinite"}}/></div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <button onClick={()=>setShowProfile(true)} style={{display:"flex",alignItems:"center",gap:10,background:"none",border:"none",cursor:"pointer",padding:0}}>
            <div style={{width:38,height:38,borderRadius:10,border:`2px solid ${ri.color}`,background:`${ri.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:900,fontFamily:"'Cinzel',serif",color:ri.color,boxShadow:`0 0 16px ${ri.color}88`,overflow:"hidden",flexShrink:0}}>
                    {(()=>{const p=localStorage.getItem(`rku_photo_${user.email}`);return p?<img src={p} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:ri.rank;})()}
                  </div>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:9,letterSpacing:3,color:"#444"}}>RANKUP{cls?` · ${cls.name.toUpperCase()}`:""}</div>
              <div style={{fontSize:16,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif",lineHeight:1}}>{user.name}</div>
              <div style={{fontSize:10,color:ri.color}}>Nivel {level} · {ri.title}</div>
            </div>
          </button>
          <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
            <div style={{fontSize:20,fontWeight:700,color:ri.color,fontFamily:"'Rajdhani',sans-serif",lineHeight:1}}>{totalXp.toLocaleString()} XP</div>
            <div style={{fontSize:10,color:"#555"}}>{xpInLvl}/{XP_PER_LEVEL} → lv.{level+1}</div>
            <div style={{display:"flex",gap:6}}>
              {activeRaid&&!activeRaid.done&&(
                <button onClick={()=>setRaidModal(true)}
                  style={{fontSize:11,fontWeight:700,color:"#E84A5F",background:"#E84A5F18",border:"1px solid #E84A5F",borderRadius:20,padding:"3px 10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",animation:"bossGlow 2s ease-in-out infinite",display:"flex",alignItems:"center",gap:4}}>
                  <span>{activeRaid.raid.icon}</span><span>RAID</span>
                </button>
              )}
              <button onClick={()=>setTab("tienda")} style={{fontSize:14,fontWeight:700,color:"#F59E0B",background:"#F59E0B18",border:"1px solid #F59E0B44",borderRadius:20,padding:"3px 12px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>🪙 {coins.toLocaleString()}</button>
              <button onClick={onLogout} title="Cerrar sesión" style={{fontSize:13,background:"#E84A5F18",border:"1px solid #E84A5F44",borderRadius:20,padding:"3px 10px",cursor:"pointer",color:"#E84A5F",fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>✕</button>
            </div>
          </div>
        </div>
        <div style={{height:6,background:"#1A1A2E",borderRadius:3,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${xpPct}%`,background:`linear-gradient(90deg,${ri.color}88,${ri.color})`,borderRadius:3,transition:"width .8s ease",boxShadow:`0 0 10px ${ri.color}`}}/>
        </div>
      </div>

      {/* SCROLL AREA */}
      <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:"0 14px 20px"}}>
        {/* Tabs */}
        <div style={{display:"flex",gap:5,paddingTop:12}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>{setTab(t.id);if(t.id==="buzon")markMessagesRead();}} style={{flex:1,padding:"10px 2px",borderRadius:8,cursor:"pointer",fontSize:15,background:tab===t.id?(t.id==="tienda"?"#F59E0B18":`${ph.color}18`):"transparent",border:`1px solid ${tab===t.id?(t.id==="tienda"?"#F59E0B":ph.color):"#1E1E32"}`,color:tab===t.id?(t.id==="tienda"?"#F59E0B":ph.color):"#555"}}>{t.l}</button>
          ))}
        </div>
        {/* Content */}
        <div key={tab+activePhase} className="fade-up" style={{marginTop:12,paddingBottom:10}}>
          {tab==="misiones"&&(
            assignedProgram?(
              <>
                {/* Phase selector */}
                <div style={{display:"flex",gap:8,marginBottom:12}}>
                  {assignedProgram.phases.map((p,i)=>(
                    <button key={i} onClick={()=>{setActivePhase(i);setOpenDay(null);}} style={{flex:1,padding:"10px 4px",borderRadius:10,cursor:"pointer",background:activePhase===i?`${p.color}18`:"#0D0D1A",border:`1px solid ${activePhase===i?p.color:"#1E1E32"}`,boxShadow:activePhase===i?`0 0 20px ${p.color}44`:"none"}}>
                      <div style={{fontSize:9,color:activePhase===i?p.color:"#444",letterSpacing:2,fontFamily:"'Rajdhani',sans-serif"}}>{p.name}</div>
                      <div style={{fontSize:11,color:activePhase===i?"#FFF":"#555",fontWeight:600}}>{p.subtitle}</div>
                    </button>
                  ))}
                </div>
                {/* Dungeon header */}
                {(()=>{const ph=assignedProgram.phases[activePhase]||assignedProgram.phases[0];
                  const phTotal=ph.training.reduce((a,d)=>a+d.exercises.length,0);
                  const phDone=ph.training.reduce((a,d,di)=>a+d.exercises.filter((_,ei)=>checked[exKey(ph.id,di,ei)]).length,0);
                  const phXpT=ph.training.reduce((a,d)=>a+d.exercises.reduce((b,ex)=>b+ex.xp,0),0);
                  const phXpE=ph.training.reduce((a,d,di)=>a+d.exercises.reduce((b,ex,ei)=>b+(checked[exKey(ph.id,di,ei)]?ex.xp:0),0),0);
                  return(
                    <>
                      <div style={{marginBottom:12,padding:18,borderRadius:14,position:"relative",overflow:"hidden",background:`linear-gradient(135deg,${ph.color}14,#0D0D1A)`,border:`1px solid ${ph.color}44`}}>
                        <div style={{fontSize:9,letterSpacing:5,color:ph.color,marginBottom:4}}>📍 {ph.dungeonName.toUpperCase()}</div>
                        <div style={{fontSize:20,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif",marginBottom:3}}>{ph.name}: {ph.subtitle}</div>
                        <div style={{fontSize:11,color:"#666",marginBottom:14}}>{ph.weeks} · {ph.goal}</div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#555",marginBottom:6}}><span>Misiones: {phDone}/{phTotal}</span><span style={{color:ph.color}}>+{phXpE}/{phXpT} XP</span></div>
                        <div style={{height:8,background:"#1A1A2E",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${phTotal>0?(phDone/phTotal)*100:0}%`,background:`linear-gradient(90deg,${ph.color}88,${ph.color})`,borderRadius:4,transition:"width .6s ease",boxShadow:`0 0 8px ${ph.color}`}}/></div>
                      </div>
                      <MissionTab ph={ph} checked={checked} weights={weights} pr={pr} wInputs={wInputs} openDay={openDay} openChart={openChart} onToggleDay={k=>setOpenDay(openDay===k?null:k)} onToggleEx={toggleEx} onLogWeight={logWeight} onDeleteWeight={deleteWeight} onWInput={(k,v)=>setWInputs(p=>({...p,[k]:v}))} onToggleChart={k=>setOpenChart(openChart===k?null:k)} extraRoutines={routines} exNotes={exNotes} onNote={(k,v)=>setExNotes(p=>({...p,[k]:v}))} exHistory={exHistory}/>
                    </>
                  );
                })()}
              </>
            ):(
              routines.length>0?(
                <RoutinesOnlyTab
                  routines={routines}
                  checked={checked}
                  weights={weights}
                  pr={pr}
                  wInputs={wInputs}
                  onToggleEx={toggleEx}
                  onLogWeight={logWeight}
                  onDeleteWeight={deleteWeight}
                  onWInput={(k,v)=>setWInputs(p=>({...p,[k]:v}))}
                  openChart={openChart}
                  onToggleChart={k=>setOpenChart(openChart===k?null:k)}
                  onUpdateRoutines={newRoutines=>{setRoutines(newRoutines);}}
                  exNotes={exNotes}
                  onNote={(k,v)=>setExNotes(p=>({...p,[k]:v}))}
                  exHistory={exHistory}
                />
              ):(
              <div style={{textAlign:"center",padding:"80px 20px",color:"#333"}}>
                <div style={{fontSize:52,marginBottom:16}}>⚔️</div>
                <div style={{fontSize:18,fontWeight:700,color:"#444",fontFamily:"'Cinzel',serif",marginBottom:8}}>Sin programa asignado</div>
                <div style={{fontSize:13,color:"#333",lineHeight:1.7}}>Tu entrenador aún no te ha asignado un programa.<br/>Pronto tendrás tus misiones esperándote.</div>
              </div>
              )
            )
          )}
          {tab==="cuerpo"&&<CuerpoTab mxp={mxp} sex={userSex}/>}
          {tab==="tienda"&&<TiendaTab coins={coins} redeemed={redeemed} dc={dc} onRedeem={redeemReward}/>}
          {tab==="nutricion"&&(
            <>
              {assignedProgram?(
                <>
                  <div style={{display:"flex",gap:8,marginBottom:12}}>
                    {assignedProgram.phases.map((p,i)=>(
                      <button key={i} onClick={()=>setActivePhase(i)} style={{flex:1,padding:"10px 4px",borderRadius:10,cursor:"pointer",background:activePhase===i?`${p.color}18`:"#0D0D1A",border:`1px solid ${activePhase===i?p.color:"#1E1E32"}`,boxShadow:activePhase===i?`0 0 20px ${p.color}44`:"none"}}>
                        <div style={{fontSize:9,color:activePhase===i?p.color:"#444",letterSpacing:2,fontFamily:"'Rajdhani',sans-serif"}}>{p.name}</div>
                        <div style={{fontSize:11,color:activePhase===i?"#FFF":"#555",fontWeight:600}}>{p.subtitle}</div>
                      </button>
                    ))}
                  </div>
                  <NutricionTab ph={assignedProgram.phases[activePhase]||assignedProgram.phases[0]} assignedDiets={assignedDiets}/>
                </>
              ):assignedDiets.length>0?(
                <NutricionTab ph={PHASES[0]} assignedDiets={assignedDiets}/>
              ):(
                <div style={{textAlign:"center",padding:"80px 20px",color:"#333"}}>
                  <div style={{fontSize:52,marginBottom:16}}>🍖</div>
                  <div style={{fontSize:18,fontWeight:700,color:"#444",fontFamily:"'Cinzel',serif",marginBottom:8}}>Sin dieta asignada</div>
                  <div style={{fontSize:13,color:"#333",lineHeight:1.7}}>Tu entrenador aún no te ha asignado una dieta.<br/>Pronto tendrás tu plan nutricional personalizado.</div>
                </div>
              )}
            </>
          )}
          {tab==="logros"&&<LogrosTab totalXp={totalXp} level={level} ri={ri} checked={checked} weights={weights} pr={pr} earnedAchs={earnedAchs} routines={routines}/>}
          {tab==="ranking"&&<RankingTab currentEmail={user.email} currentName={user.name}/>}
          {tab==="buzon"&&<BuzonTab messages={messages} onSend={sendMessage} userName={user.name}/>}
        </div>
      </div>
      <div style={{flexShrink:0,background:"#07070F",padding:"8px 16px 12px",borderTop:`1px solid ${ri.color}33`,textAlign:"center"}}>
        <div style={{fontSize:9,color:"#2A2A44",letterSpacing:4}}>SISTEMA RANKUP · FITNESS · {ri.rank}-RANGO</div>
      </div>
    </div>
  );
}

// ─── MISSION TAB ──────────────────────────────────────────────────────────────
function RoutinesOnlyTab({routines,checked,weights,pr,wInputs,onToggleEx,onLogWeight,onDeleteWeight,onWInput,openChart,onToggleChart,onUpdateRoutines,exNotes={},onNote,exHistory={}}){
  const [rtHistoryModal,setRtHistoryModal]=useState(null);
  const [openSess,setOpenSess]=useState(null);
  const [addModal,setAddModal]=useState(null);   // {rtId, si} — session to add to
  const [swapModal,setSwapModal]=useState(null); // {rtId, si, ei, exName, muscles}
  const [searchQ,setSearchQ]=useState("");
  const [pendingAdd,setPendingAdd]=useState(null); // {rtId, si, ex} — exercise picked, awaiting config
  const [pendingSets,setPendingSets]=useState("3x10");
  const [pendingRest,setPendingRest]=useState("60s");

  const handleAddEx=(rtId,si,ex)=>{
    // Show config step before adding
    setPendingAdd({rtId,si,ex});
    setPendingSets("3x10");
    setPendingRest("60s");
    setAddModal(null);
    setSearchQ("");
  };

  const confirmAddEx=()=>{
    if(!pendingAdd) return;
    const {rtId,si,ex}=pendingAdd;
    const updated=routines.map(rt=>{
      if(rt.id!==rtId) return rt;
      const sessions=[...(rt.sessions||[])];
      sessions[si]={...sessions[si],exercises:[...sessions[si].exercises,
        {name:ex.name,sets:pendingSets,rest:pendingRest,xp:ex.xpBase||35,boss:false}]};
      return {...rt,sessions};
    });
    onUpdateRoutines(updated);
    setPendingAdd(null);
  };

  const handleSwapEx=(rtId,si,ei,ex)=>{
    const updated=routines.map(rt=>{
      if(rt.id!==rtId) return rt;
      const sessions=[...(rt.sessions||[])];
      const exs=[...sessions[si].exercises];
      exs[ei]={...exs[ei],name:ex.name,xp:ex.xpBase||35};
      sessions[si]={...sessions[si],exercises:exs};
      return {...rt,sessions};
    });
    onUpdateRoutines(updated);
    setSwapModal(null);setSearchQ("");
  };

  // Modal shared for add/swap
  const modalCtx=addModal||swapModal;
  const isSwap=!!swapModal;
  const filteredExs=modalCtx?(()=>{
    const q=searchQ.toLowerCase();
    let pool=EXERCISE_DB;
    // For swap: filter to same muscle group
    if(isSwap&&swapModal.muscles?.length){
      pool=EXERCISE_DB.filter(e=>e.muscle.some(m=>swapModal.muscles.includes(m)));
    }
    if(q) pool=pool.filter(e=>e.name.toLowerCase().includes(q)||e.muscle.some(m=>m.toLowerCase().includes(q)));
    return pool.slice(0,40);
  })():[];

  return(
    <div>
      <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3,marginBottom:14}}>👑 MAZMORRAS ASIGNADAS · {routines.length} RUTINAS</div>
      {routines.map(rt=>{
        const c=rt.color||"#A78BFA";
        const sessions=rt.sessions||[{day:rt.name,exercises:rt.exercises||[]}];
        return(
          <div key={rt.id} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{padding:"3px 12px",borderRadius:20,fontSize:9,fontWeight:700,letterSpacing:3,fontFamily:"'Rajdhani',sans-serif",background:`${c}22`,border:`1px solid ${c}55`,color:c}}>👑 {rt.name.toUpperCase()}</div>
              <div style={{flex:1,height:1,background:`linear-gradient(90deg,${c}33,transparent)`}}/>
            </div>
            {sessions.map((sess,si)=>{
              const sk=`${rt.id}_${si}`;
              const isOpen=openSess===sk;
              const sessDone=sess.exercises.filter((_,ei)=>checked[`rt_${rt.id}_${si}_${ei}`]).length;
              const sessTotal=sess.exercises.length;
              const allDone=sessDone===sessTotal&&sessTotal>0;
              const sessXpDone=sess.exercises.reduce((a,ex,ei)=>a+(checked[`rt_${rt.id}_${si}_${ei}`]?(ex.xp||35):0),0);
              const sessXpTotal=sess.exercises.reduce((a,ex)=>a+(ex.xp||35),0);
              const bossDone=sess.exercises.filter((ex,ei)=>ex.boss&&checked[`rt_${rt.id}_${si}_${ei}`]).length;
              const bossTotal=sess.exercises.filter(ex=>ex.boss).length;
              return(
                <div key={si} style={{marginBottom:10}}>
                  <button onClick={()=>setOpenSess(isOpen?null:sk)}
                    style={{width:"100%",textAlign:"left",padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",color:"#E8E6FF",
                      background:isOpen?`linear-gradient(135deg,${c}18,#0D0D1A)`:"#0F0F1C",
                      border:`1px solid ${isOpen?c+"66":allDone?c+"44":"#1E1E32"}`,
                      borderRadius:isOpen?"12px 12px 0 0":12,
                      boxShadow:allDone?`0 0 16px ${c}33`:"none"}}>
                    <div>
                      <div style={{fontSize:9,color:c,letterSpacing:3,marginBottom:2}}>{allDone?"✅ DUNGEON COMPLETADO":`DUNGEON ${si+1}`}</div>
                      <div style={{fontSize:14,fontWeight:700,color:allDone?c:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{sess.day}</div>
                      {bossTotal>0&&<div style={{fontSize:9,color:"#E84A5F",letterSpacing:1,marginTop:2}}>💀 {bossDone}/{bossTotal} BOSS</div>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12,color:c,fontWeight:700}}>+{sessXpDone}/{sessXpTotal} XP</div>
                      <div style={{fontSize:11,color:allDone?c:"#444"}}>{sessDone}/{sessTotal} ✓</div>
                      {allDone&&<div style={{fontSize:10,color:"#F59E0B",fontWeight:700}}>🪙 +{COIN_DUNGEON}</div>}
                    </div>
                  </button>
                  {isOpen&&(
                    <div style={{border:`1px solid ${c}33`,borderTop:"none",borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
                      {sess.exercises.map((ex,ei)=>{
                        const key=`rt_${rt.id}_${si}_${ei}`;
                        const isDone=!!checked[key];
                        const exW=weights[key]||[];
                        const lastKg=exW.length>0?exW[exW.length-1].kg:null;
                        const maxKg=exW.length>0?Math.max(...exW.map(w=>w.kg)):null;
                        const isPR=maxKg&&pr[key]===maxKg;
                        const isChartOpen=openChart===key;
                        const exMuscles=MUSCLE_MAP[ex.name]||EXERCISE_DB.find(e=>e.name===ex.name)?.muscle||[];
                        return(
                          <div key={ei} style={{background:isDone?`${c}10`:ei%2===0?"#0D0D19":"#0F0F1C",borderTop:"1px solid #1A1A2C",animation:ex.boss&&!isDone?"bossGlow 2s ease-in-out infinite":"none"}}>
                            <div style={{padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                              <button onClick={e=>onToggleEx(key,ex.xp||35,null,null,e,ex.name)}
                                style={{width:32,height:32,borderRadius:8,flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                                  border:`2px solid ${isDone?c:ex.boss?"#E84A5F":"#2A2A44"}`,
                                  background:isDone?c:"transparent",
                                  boxShadow:isDone?`0 0 12px ${c}`:"none",transition:"all .2s"}}>
                                {isDone?<span style={{color:"#07070F",fontSize:15,fontWeight:900}}>✓</span>:ex.boss?<span style={{fontSize:13}}>💀</span>:<span style={{fontSize:12,color:"#2A2A44"}}>⚔</span>}
                              </button>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                  <span style={{fontSize:14,fontWeight:700,color:isDone?"#444":"#FFF",textDecoration:isDone?"line-through":"none",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}</span>
                                  {ex.boss&&!isDone&&<span style={{fontSize:9,padding:"2px 7px",background:"#E84A5F22",border:"1px solid #E84A5F66",borderRadius:20,color:"#E84A5F",letterSpacing:1}}>BOSS</span>}
                                </div>
                                {ex.notes&&<div style={{fontSize:11,color:"#444",marginTop:2}}>{ex.notes}</div>}
                                {/* Muscle tags */}
                                <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                                  {exMuscles.map(m=><span key={m} style={{fontSize:8,padding:"1px 6px",background:"#1A1A2E",border:"1px solid #2A2A3E",borderRadius:10,color:"#555",letterSpacing:1}}>{m.toUpperCase()}</span>)}
                                </div>
                              </div>
                              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
                                <div style={{textAlign:"right"}}>
                                  <div style={{fontSize:13,color:c,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>{ex.sets}</div>
                                  <div style={{fontSize:10,color:"#444"}}>{ex.rest}</div>
                                  <div style={{fontSize:11,color:"#5A5A7A",fontWeight:700}}>+{ex.xp||35} XP</div>
                                  {lastKg>0&&<div style={{fontSize:10,color:c,fontWeight:700}}>{lastKg}kg</div>}
                                </div>
                                {/* Swap button */}
                                {!isDone&&<button onClick={()=>{setSwapModal({rtId:rt.id,si,ei,exName:ex.name,muscles:exMuscles});setSearchQ("");}}
                                  style={{fontSize:9,padding:"3px 8px",background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:6,color:"#666",cursor:"pointer",letterSpacing:1,fontFamily:"'Rajdhani',sans-serif"}}>🔄 CAMBIAR</button>}
                              </div>
                            </div>
                            <div style={{padding:"0 14px 12px 56px"}}>
                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                <input type="number" min="0" step="0.5" placeholder="kg" value={wInputs[key]||""} onChange={e=>onWInput(key,e.target.value)}
                                  onKeyDown={e=>{if(e.key==="Enter")onLogWeight(key,e,ex.name);}}
                                  style={{width:66,padding:"7px 10px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif"}}/>
                                <button onClick={e=>onLogWeight(key,e,ex.name)}
                                  style={{padding:"7px 16px",background:c,border:"none",borderRadius:8,color:"#07070F",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+ LOG</button>
                                {exHistory[ex.name]?.length>0&&<button onClick={()=>setRtHistoryModal({exName:ex.name,history:exHistory[ex.name],color:c})}
                                  style={{padding:"6px 12px",background:"transparent",border:`1px solid ${c}44`,borderRadius:8,color:c,fontSize:11,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>📊 HISTORIAL</button>}
                              </div>
                              {isPR&&<div style={{marginTop:6,display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",background:"#FBBF2422",border:"1px solid #FBBF2466",borderRadius:20,fontSize:10,color:"#FBBF24",letterSpacing:1}}>🏆 RÉCORD: {maxKg}kg</div>}
                              {exW.length>0&&<div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>{exW.map((w,wi)=>(
                                <span key={wi} style={{fontSize:10,padding:"2px 6px 2px 8px",background:"#1A1A2E",border:`1px solid ${c}22`,borderRadius:20,color:"#666",display:"flex",alignItems:"center",gap:4}}>
                                  <span style={{color:c,fontWeight:700}}>{w.kg}kg</span> {w.session}
                                  <button onClick={()=>onDeleteWeight&&onDeleteWeight(key,wi)} style={{background:"none",border:"none",color:"#E84A5F",cursor:"pointer",fontSize:10,padding:0,lineHeight:1}}>✕</button>
                                </span>
                              ))}</div>}
                              {isChartOpen&&exW.length>=2&&<MiniChart data={exW} color={c}/>}
                              {/* User notes */}
                              <textarea
                                placeholder="📝 Anotaciones personales..."
                                value={exNotes[key]||""}
                                onChange={e=>onNote&&onNote(key,e.target.value)}
                                style={{width:"100%",marginTop:8,padding:"8px 10px",background:"#0A0A14",border:"1px solid #2A2A3E",borderRadius:8,color:"#AAA",fontSize:11,outline:"none",fontFamily:"'Rajdhani',sans-serif",resize:"none",minHeight:36,lineHeight:1.4,boxSizing:"border-box"}}
                                rows={2}/>
                            </div>
                          </div>
                        );
                      })}
                      {/* Add exercise button */}
                      <button onClick={()=>{setAddModal({rtId:rt.id,si});setSearchQ("");}}
                        style={{width:"100%",padding:"12px",background:"transparent",border:"none",borderTop:"1px solid #1A1A2C",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:"#3A3A5E"}}>
                        <span style={{fontSize:16,color:c}}>＋</span>
                        <span style={{fontSize:11,letterSpacing:2,fontFamily:"'Rajdhani',sans-serif",color:c}}>AÑADIR EJERCICIO</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* ── PENDING ADD CONFIG MODAL ── */}
      {pendingAdd&&(
        <div style={{position:"fixed",inset:0,background:"#000000CC",zIndex:200,display:"flex",alignItems:"flex-end"}} onClick={()=>setPendingAdd(null)}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",background:"#0D0D1A",borderRadius:"20px 20px 0 0",border:"1px solid #1E1E32",padding:20}}>
            <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3,marginBottom:4}}>⚔️ CONFIGURAR EJERCICIO</div>
            <div style={{fontSize:16,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",marginBottom:16}}>{pendingAdd.ex.name}</div>
            <div style={{display:"flex",gap:10,marginBottom:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,marginBottom:4}}>SERIES</div>
                <input value={pendingSets} onChange={e=>setPendingSets(e.target.value)}
                  placeholder="ej: 4x10"
                  style={{width:"100%",padding:"10px 12px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:9,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",boxSizing:"border-box"}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,marginBottom:4}}>DESCANSO</div>
                <input value={pendingRest} onChange={e=>setPendingRest(e.target.value)}
                  placeholder="ej: 90s"
                  style={{width:"100%",padding:"10px 12px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:9,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",boxSizing:"border-box"}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setPendingAdd(null)}
                style={{flex:1,padding:12,background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:10,color:"#666",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:12,letterSpacing:2}}>CANCELAR</button>
              <button onClick={confirmAddEx}
                style={{flex:2,padding:12,background:"linear-gradient(135deg,#A78BFA,#7C3AED)",border:"none",borderRadius:10,color:"#FFF",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:700,letterSpacing:2}}>✓ AÑADIR</button>
            </div>
          </div>
        </div>
      )}

      {rtHistoryModal&&<ExHistoryModal exName={rtHistoryModal.exName} history={rtHistoryModal.history} color={rtHistoryModal.color} onClose={()=>setRtHistoryModal(null)}/>}
      {/* ── ADD / SWAP MODAL ── */}
      {modalCtx&&(
        <div style={{position:"fixed",inset:0,background:"#000000CC",zIndex:200,display:"flex",alignItems:"flex-end"}} onClick={()=>{setAddModal(null);setSwapModal(null);setSearchQ("");}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxHeight:"75vh",background:"#0D0D1A",borderRadius:"20px 20px 0 0",border:"1px solid #1E1E32",display:"flex",flexDirection:"column"}}>
            {/* Modal header */}
            <div style={{padding:"16px 20px 12px",borderBottom:"1px solid #1A1A2E"}}>
              <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3,marginBottom:4}}>{isSwap?"🔄 INTERCAMBIAR EJERCICIO":"⚔️ AÑADIR EJERCICIO"}</div>
              {isSwap&&<div style={{fontSize:11,color:"#444",marginBottom:8}}>Actual: <span style={{color:"#FFF",fontWeight:700}}>{swapModal.exName}</span> · Mostrando mismo grupo muscular</div>}
              <input autoFocus value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Buscar por nombre o músculo..."
                style={{width:"100%",padding:"10px 14px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:10,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",boxSizing:"border-box"}}/>
            </div>
            {/* Exercise list */}
            <div style={{overflowY:"auto",flex:1}}>
              {filteredExs.length===0&&<div style={{padding:"30px",textAlign:"center",color:"#333",fontSize:12}}>Sin resultados</div>}
              {filteredExs.map(ex=>{
                const isCurrent=isSwap&&ex.name===swapModal?.exName;
                return(
                  <button key={ex.id} disabled={isCurrent} onClick={()=>isSwap?handleSwapEx(swapModal.rtId,swapModal.si,swapModal.ei,ex):handleAddEx(addModal.rtId,addModal.si,ex)}
                    style={{width:"100%",textAlign:"left",padding:"12px 20px",background:isCurrent?"#1A1A2E":"transparent",border:"none",borderBottom:"1px solid #1A1A2C",cursor:isCurrent?"default":"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:isCurrent?"#444":"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}{isCurrent&&" (actual)"}</div>
                      <div style={{display:"flex",gap:4,marginTop:3,flexWrap:"wrap"}}>
                        {ex.muscle.map(m=><span key={m} style={{fontSize:8,padding:"1px 6px",background:"#1A1A2E",border:"1px solid #2A2A3E",borderRadius:10,color:"#666",letterSpacing:1}}>{m.toUpperCase()}</span>)}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                      <div style={{fontSize:10,color:"#555"}}>{ex.level}</div>
                      <div style={{fontSize:11,color:"#A78BFA",fontWeight:700}}>+{ex.xpBase} XP</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button onClick={()=>{setAddModal(null);setSwapModal(null);setSearchQ("");}}
              style={{margin:"12px 20px",padding:"12px",background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:10,color:"#666",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:12,letterSpacing:2}}>CANCELAR</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MissionTab({ph,checked,weights,pr,wInputs,openDay,openChart,onToggleDay,onToggleEx,onLogWeight,onDeleteWeight,onWInput,onToggleChart,extraRoutines=[],exNotes={},onNote,exHistory={}}){
  const [historyModal,setHistoryModal]=useState(null);
  const [openRt,setOpenRt]=useState(null);
  const [openRtSess,setOpenRtSess]=useState(null);
  let lastWeek=null;
  return(
    <div>
      <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:14}}>LISTA DE MISIONES · {ph.training.length} SESIONES · 4 SEMANAS</div>
      {ph.training.map((day,di)=>{
        const weekSep=day.week!==lastWeek?(lastWeek=day.week,day.week):null;
        const dayDone=day.exercises.filter((_,ei)=>checked[exKey(ph.id,di,ei)]).length;
        const allDone=dayDone===day.exercises.length;
        const dayXpE=day.exercises.reduce((a,ex,ei)=>a+(checked[exKey(ph.id,di,ei)]?ex.xp:0),0);
        const dayXpT=day.exercises.reduce((a,ex)=>a+ex.xp,0);
        const dk=`${ph.id}-${di}`;const isOpen=openDay===dk;
        return(
          <div key={dk}>
            {weekSep!==null&&(
              <div style={{display:"flex",alignItems:"center",gap:10,margin:`${di===0?"0":"16px"} 0 8px`}}>
                <div style={{padding:"3px 12px",borderRadius:20,fontSize:9,fontWeight:700,letterSpacing:3,fontFamily:"'Rajdhani',sans-serif",background:allDone?`${ph.color}22`:"#1A1A2E",border:`1px solid ${allDone?ph.color+"55":"#2A2A44"}`,color:allDone?ph.color:"#555"}}>SEMANA {day.week}{allDone?" ✓":""}</div>
                <div style={{flex:1,height:1,background:`linear-gradient(90deg,${ph.color}33,transparent)`}}/>
              </div>
            )}
            <div style={{marginBottom:10}}>
              <button onClick={()=>onToggleDay(dk)} style={{width:"100%",textAlign:"left",padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",color:"#E8E6FF",background:isOpen?`linear-gradient(135deg,${ph.color}18,#0D0D1A)`:"#0F0F1C",border:`1px solid ${isOpen?ph.color+"66":allDone?ph.color+"44":"#1E1E32"}`,borderRadius:isOpen?"12px 12px 0 0":12,boxShadow:allDone?`0 0 16px ${ph.color}33`:"none"}}>
                <div>
                  <div style={{fontSize:9,color:ph.color,letterSpacing:3,marginBottom:2}}>{allDone?"✅ DUNGEON COMPLETADO":`DUNGEON ${di+1}`}</div>
                  <div style={{fontSize:14,fontWeight:700,color:allDone?ph.color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{day.day}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,color:ph.color,fontWeight:700}}>+{dayXpE}/{dayXpT} XP</div>
                  <div style={{fontSize:11,color:allDone?ph.color:"#444"}}>{dayDone}/{day.exercises.length} ✓</div>
                  {allDone&&<div style={{fontSize:10,color:"#F59E0B",fontWeight:700}}>🪙 +{COIN_DUNGEON}</div>}
                </div>
              </button>
              {isOpen&&(
                <div style={{border:`1px solid ${ph.color}33`,borderTop:"none",borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
                  {day.exercises.map((ex,ei)=>{
                    const key=exKey(ph.id,di,ei);const isDone=!!checked[key];
                    const exW=weights[key]||[];const lastKg=exW.length>0?exW[exW.length-1].kg:null;
                    const maxKg=exW.length>0?Math.max(...exW.map(w=>w.kg)):null;
                    const isPR=maxKg&&pr[key]===maxKg;const isChartOpen=openChart===key;
                    return(
                      <div key={ei} style={{background:isDone?`${ph.color}10`:ei%2===0?"#0D0D19":"#0F0F1C",borderTop:"1px solid #1A1A2C",animation:ex.boss&&!isDone?"bossGlow 2s ease-in-out infinite":"none"}}>
                        <div style={{padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                          <button onClick={e=>onToggleEx(key,ex.xp,ph.id,di,e,ex.name)} style={{width:32,height:32,borderRadius:8,flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${isDone?ph.color:ex.boss?"#E84A5F":"#2A2A44"}`,background:isDone?ph.color:"transparent",boxShadow:isDone?`0 0 12px ${ph.color}`:"none",transition:"all .2s"}}>
                            {isDone?<span style={{color:"#07070F",fontSize:15,fontWeight:900}}>✓</span>:ex.boss?<span style={{fontSize:13}}>💀</span>:<span style={{fontSize:12,color:"#2A2A44"}}>⚔</span>}
                          </button>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                              <span style={{fontSize:14,fontWeight:700,color:isDone?"#444":"#FFF",textDecoration:isDone?"line-through":"none",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}</span>
                              {ex.boss&&!isDone&&<span style={{fontSize:9,padding:"2px 7px",background:"#E84A5F22",border:"1px solid #E84A5F66",borderRadius:20,color:"#E84A5F",letterSpacing:1}}>BOSS</span>}
                            </div>
                            {ex.notes&&<div style={{fontSize:11,color:"#444",marginTop:2}}>{ex.notes}</div>}
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:13,color:ph.color,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>{ex.sets}</div>
                            <div style={{fontSize:10,color:"#444"}}>{ex.rest}</div>
                            <div style={{fontSize:11,color:"#5A5A7A",fontWeight:700}}>+{ex.xp} XP</div>
                            {lastKg>0&&<div style={{fontSize:10,color:ph.color,fontWeight:700}}>{lastKg}kg</div>}
                          </div>
                        </div>
                        <div style={{padding:"0 14px 12px 56px"}}>
                          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                            <input type="number" min="0" step="0.5" placeholder="kg" value={wInputs[key]||""} onChange={e=>onWInput(key,e.target.value)} onKeyDown={e=>e.key==="Enter"&&onLogWeight(key,e,ex.name)} style={{width:66,padding:"7px 10px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif"}}/>
                            <button onClick={e=>onLogWeight(key,e,ex.name)} style={{padding:"7px 16px",background:ph.color,border:"none",borderRadius:8,color:"#07070F",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+ LOG</button>
                            {exHistory[ex.name]?.length>0&&<button onClick={()=>setHistoryModal({exName:ex.name,history:exHistory[ex.name],color:ph.color})} style={{padding:"6px 12px",background:"transparent",border:`1px solid ${ph.color}44`,borderRadius:8,color:ph.color,fontSize:11,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>📊 HISTORIAL</button>}
                          </div>
                          {isPR&&<div style={{marginTop:6,display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",background:"#FBBF2422",border:"1px solid #FBBF2466",borderRadius:20,fontSize:10,color:"#FBBF24",letterSpacing:1}}>🏆 RÉCORD: {maxKg}kg</div>}
                          {exW.length>0&&<div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>{exW.map((w,wi)=><span key={wi} style={{fontSize:10,padding:"2px 6px 2px 8px",background:"#1A1A2E",border:`1px solid ${ph.color}22`,borderRadius:20,color:"#666",display:"flex",alignItems:"center",gap:4}}><span style={{color:ph.color,fontWeight:700}}>{w.kg}kg</span> {w.session}<button onClick={()=>onDeleteWeight&&onDeleteWeight(key,wi)} style={{background:"none",border:"none",color:"#E84A5F",cursor:"pointer",fontSize:10,padding:0,lineHeight:1}}>✕</button></span>)}</div>}
                          {/* User notes */}
                          <textarea
                            placeholder="📝 Anotaciones personales..."
                            value={exNotes[key]||""}
                            onChange={e=>onNote&&onNote(key,e.target.value)}
                            style={{width:"100%",marginTop:8,padding:"8px 10px",background:"#0A0A14",border:"1px solid #2A2A3E",borderRadius:8,color:"#AAA",fontSize:11,outline:"none",fontFamily:"'Rajdhani',sans-serif",resize:"none",minHeight:36,lineHeight:1.4,boxSizing:"border-box"}}
                            rows={2}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {extraRoutines.filter(rt=>rt.assignedByAdmin===true).length>0&&(
        <div style={{marginTop:20}}>
          <div style={{display:"flex",alignItems:"center",gap:10,margin:"0 0 8px"}}>
            <div style={{padding:"3px 12px",borderRadius:20,fontSize:9,fontWeight:700,letterSpacing:3,fontFamily:"'Rajdhani',sans-serif",background:"#A78BFA22",border:"1px solid #A78BFA55",color:"#A78BFA"}}>👑 RUTINAS ADICIONALES</div>
            <div style={{flex:1,height:1,background:"linear-gradient(90deg,#A78BFA33,transparent)"}}/>
          </div>
          {extraRoutines.filter(rt=>rt.assignedByAdmin===true).map(rt=>{
            const c=rt.color||"#A78BFA";
            const totalEx=rt.sessions?.reduce((a,s)=>a+s.exercises.length,0)||0;
            const doneEx=rt.sessions?.reduce((a,s)=>a+s.exercises.filter(e=>e.done).length,0)||0;
            const allDone=doneEx===totalEx&&totalEx>0;
            const isOpen=openRt===rt.id;
            return(
              <div key={rt.id} style={{marginBottom:10}}>
                <button onClick={()=>setOpenRt(isOpen?null:rt.id)}
                  style={{width:"100%",textAlign:"left",padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",color:"#E8E6FF",background:isOpen?`linear-gradient(135deg,${c}18,#0D0D1A)`:"#0F0F1C",border:`1px solid ${isOpen?c+"66":allDone?c+"44":"#1E1E32"}`,borderRadius:isOpen?"12px 12px 0 0":12,boxShadow:allDone?`0 0 16px ${c}33`:"none"}}>
                  <div>
                    <div style={{fontSize:9,color:c,letterSpacing:3,marginBottom:2}}>{allDone?"✅ RUTINA COMPLETADA":"👑 RUTINA ASIGNADA"}</div>
                    <div style={{fontSize:14,fontWeight:700,color:allDone?c:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{rt.name}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,color:c,fontWeight:700}}>+{doneEx}/{totalEx} XP</div>
                    <div style={{fontSize:11,color:allDone?c:"#444"}}>{doneEx}/{totalEx} ✓</div>
                  </div>
                </button>
                {isOpen&&(
                  <div style={{border:`1px solid ${c}33`,borderTop:"none",borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
                    {rt.sessions?.map((sess,si)=>{
                      const sk=`${rt.id}-${si}`;
                      const isSessOpen=openRtSess===sk;
                      const sessDone=sess.exercises.filter(e=>e.done).length;
                      return(
                        <div key={si} style={{borderBottom:"1px solid #1A1A2E"}}>
                          <button onClick={()=>setOpenRtSess(isSessOpen?null:sk)}
                            style={{width:"100%",textAlign:"left",padding:"12px 16px",background:isSessOpen?`${c}0D`:"transparent",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div style={{fontSize:13,fontWeight:700,color:isSessOpen?c:"#AAA",fontFamily:"'Rajdhani',sans-serif"}}>{sess.day}</div>
                            <div style={{fontSize:11,color:sessDone===sess.exercises.length&&sess.exercises.length>0?c:"#444"}}>{sessDone}/{sess.exercises.length} ✓</div>
                          </button>
                          {isSessOpen&&(
                            <div style={{background:"#0D0D19"}}>
                              {sess.exercises.map((ex,ei)=>(
                                <div key={ei} style={{padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start",borderTop:"1px solid #1A1A2C",background:ex.done?`${c}10`:ei%2===0?"#0D0D19":"#0F0F1C"}}>
                                  <div style={{width:32,height:32,borderRadius:8,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${ex.done?c:"#2A2A44"}`,background:ex.done?c:"transparent"}}>
                                    {ex.done?<span style={{color:"#07070F",fontSize:15,fontWeight:900}}>✓</span>:<span style={{fontSize:12,color:"#2A2A44"}}>⚔</span>}
                                  </div>
                                  <div style={{flex:1}}>
                                    <div style={{fontSize:14,fontWeight:700,color:ex.done?"#444":"#FFF",textDecoration:ex.done?"line-through":"none",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}</div>
                                  </div>
                                  <div style={{textAlign:"right",flexShrink:0}}>
                                    <div style={{fontSize:13,color:c,fontWeight:700}}>{ex.sets}</div>
                                    <div style={{fontSize:10,color:"#444"}}>{ex.rest}</div>
                                    <div style={{fontSize:11,color:"#5A5A7A",fontWeight:700}}>+{ex.xp||35} XP</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{marginTop:20,padding:18,borderRadius:12,textAlign:"center",background:`linear-gradient(135deg,${ph.color}10,transparent)`,border:`1px solid ${ph.color}33`}}>
        <div style={{fontSize:9,color:"#444",letterSpacing:4,marginBottom:10}}>MANTRA RANKUP</div>
        <p style={{fontSize:14,color:"#AAA",fontStyle:"italic",margin:0,lineHeight:1.6}}>"{ph.mantra}"</p>
      </div>
    </div>
  );
}

// ─── RUTINAS TAB ──────────────────────────────────────────────────────────────
function RutinasTab({routines,setRoutines,addXp,phases=[],checked={},exKey=()=>""}){
  const [openRt,setOpenRt]=useState(null);
  const [openSess,setOpenSess]=useState(null);
  const [addingTo,setAddingTo]=useState(null);
  const [newEx,setNewEx]=useState({name:"",sets:"3x10",rest:"60s"});
  const [dbOpen,setDbOpen]=useState(false);
  const [dbFilter,setDbFilter]=useState({muscle:"todos",level:"todos",search:""});
  const [openDay,setOpenDay]=useState(null);

  const assigned=routines.filter(rt=>rt.assignedByAdmin===true);

  const toggleEx=(rtId,sIdx,eIdx)=>{
    setRoutines(prev=>prev.map(rt=>{
      if(rt.id!==rtId) return rt;
      const sessions=rt.sessions.map((s,si)=>{
        if(si!==sIdx) return s;
        const exercises=s.exercises.map((ex,ei)=>{
          if(ei!==eIdx) return ex;
          const nowDone=!ex.done;
          if(nowDone) addXp(ex.xp||35,null);
          return {...ex,done:nowDone};
        });
        return {...s,exercises};
      });
      return {...rt,sessions};
    }));
  };

  const addExToSession=(rtId,sIdx)=>{
    if(!newEx.name.trim()) return;
    setRoutines(prev=>prev.map(rt=>{
      if(rt.id!==rtId) return rt;
      const sessions=rt.sessions.map((s,si)=>{
        if(si!==sIdx) return s;
        return {...s,exercises:[...s.exercises,{name:newEx.name.trim(),sets:newEx.sets||"3x10",rest:newEx.rest||"60s",xp:35,done:false}]};
      });
      return {...rt,sessions};
    }));
    setNewEx({name:"",sets:"3x10",rest:"60s"});
    setAddingTo(null);
  };

  const addFromDB=(rtId,sIdx,ex)=>{
    setRoutines(prev=>prev.map(rt=>{
      if(rt.id!==rtId) return rt;
      const sessions=rt.sessions.map((s,si)=>{
        if(si!==sIdx) return s;
        const already=s.exercises.find(e=>e.name===ex.name);
        if(already) return s;
        return {...s,exercises:[...s.exercises,{name:ex.name,sets:"3x10",rest:"60s",xp:ex.xpBase,done:false}]};
      });
      return {...rt,sessions};
    }));
  };

  if(dbOpen){
    const [rtId,sIdx]=dbOpen;
    return(
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <button onClick={()=>setDbOpen(null)} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#60A5FA",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
          <div style={{fontSize:12,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",fontWeight:700}}>Elige ejercicio para añadir</div>
        </div>
        <EjerciciosDB filter={dbFilter} setFilter={setDbFilter} onBack={()=>setDbOpen(null)}
          onPick={ex=>{addFromDB(rtId,sIdx,ex);setDbOpen(null);}}/>
      </div>
    );
  }

  return(
    <div>
      <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:14}}>MI PROGRAMA DE ENTRENAMIENTO</div>

      {/* FASES DEL PROGRAMA */}
      {phases.map(ph=>{
        const isOpen=openRt===ph.id;
        const totalEx=ph.training.reduce((a,d)=>a+d.exercises.length,0);
        const doneEx=ph.training.reduce((a,d,di)=>a+d.exercises.filter((_,ei)=>checked[exKey(ph.id,di,ei)]).length,0);
        return(
          <div key={ph.id} style={{marginBottom:10}}>
            <button onClick={()=>setOpenRt(isOpen?null:ph.id)}
              style={{width:"100%",textAlign:"left",padding:"14px 16px",background:isOpen?`${ph.color}18`:"#0F0F1C",border:`1px solid ${isOpen?ph.color:ph.color+"33"}`,borderRadius:isOpen?"12px 12px 0 0":12,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:isOpen?`0 0 20px ${ph.color}22`:"none"}}>
              <div>
                <div style={{fontSize:9,color:ph.color,letterSpacing:3,marginBottom:2}}>📍 {ph.dungeonName?.toUpperCase()}</div>
                <div style={{fontSize:15,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif"}}>{ph.name}: {ph.subtitle}</div>
                <div style={{fontSize:10,color:"#555",marginTop:2}}>{ph.weeks} · {ph.training.length} sesiones</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700,color:ph.color}}>{doneEx}/{totalEx}</div>
                <div style={{fontSize:9,color:"#444",marginBottom:4}}>completados</div>
                <div style={{fontSize:14,color:ph.color}}>{isOpen?"▲":"▼"}</div>
              </div>
            </button>
            {!isOpen&&(
              <div style={{height:3,background:"#1A1A2E",borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
                <div style={{height:"100%",width:`${totalEx>0?(doneEx/totalEx)*100:0}%`,background:ph.color,transition:"width .6s ease",boxShadow:`0 0 6px ${ph.color}`}}/>
              </div>
            )}
            {isOpen&&(
              <div style={{border:`1px solid ${ph.color}33`,borderTop:"none",borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
                {ph.training.map((day,di)=>{
                  const dk=`${ph.id}-${di}`;
                  const isDayOpen=openDay===dk;
                  const dayDone=day.exercises.filter((_,ei)=>checked[exKey(ph.id,di,ei)]).length;
                  const allDone=dayDone===day.exercises.length;
                  return(
                    <div key={di} style={{borderBottom:"1px solid #1A1A2E"}}>
                      <button onClick={()=>setOpenDay(isDayOpen?null:dk)}
                        style={{width:"100%",textAlign:"left",padding:"11px 16px",background:isDayOpen?`${ph.color}0D`:"transparent",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div>
                          <div style={{fontSize:9,color:allDone?ph.color:"#444",letterSpacing:2,marginBottom:1}}>{allDone?"✅ COMPLETADO":`SESIÓN ${di+1}`}</div>
                          <div style={{fontSize:13,fontWeight:700,color:allDone?"#555":"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{day.day}</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:10,color:allDone?ph.color:"#555"}}>{dayDone}/{day.exercises.length} ✓</span>
                          <span style={{fontSize:12,color:"#444"}}>{isDayOpen?"▲":"▼"}</span>
                        </div>
                      </button>
                      {isDayOpen&&(
                        <div style={{padding:"4px 12px 12px"}}>
                          {day.exercises.map((ex,ei)=>{
                            const k=exKey(ph.id,di,ei);
                            const done=!!checked[k];
                            return(
                              <div key={ei} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",marginBottom:5,borderRadius:9,background:done?`${ph.color}12`:"#07070F",border:`1px solid ${done?ph.color+"55":"#1A1A2E"}`}}>
                                <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${done?ph.color:"#2A2A44"}`,background:done?ph.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                  {done&&<span style={{color:"#07070F",fontSize:12,fontWeight:900}}>✓</span>}
                                </div>
                                <div style={{flex:1}}>
                                  <div style={{fontSize:12,fontWeight:700,color:done?"#555":"#FFF",textDecoration:done?"line-through":"none",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}</div>
                                  <div style={{fontSize:10,color:"#444"}}>{ex.sets} · {ex.rest}</div>
                                </div>
                                <div style={{fontSize:10,color:done?ph.color:"#444",fontWeight:700}}>+{ex.xp} XP</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* RUTINAS EXTRA ASIGNADAS POR ADMIN */}
      {assigned.length>0&&(
        <div style={{marginTop:20}}>
          <div style={{fontSize:9,color:"#A78BFA",letterSpacing:3,marginBottom:10}}>👑 RUTINAS ADICIONALES</div>
          {assigned.map(rt=>{
            const c=rt.color||"#A78BFA";
            const isOpen=openSess?.startsWith(rt.id);
            return(
              <div key={rt.id} style={{marginBottom:10}}>
                <button onClick={()=>setOpenSess(isOpen?null:`${rt.id}-open`)}
                  style={{width:"100%",textAlign:"left",padding:"14px 16px",background:isOpen?`${c}18`:"#0F0F1C",border:`1px solid ${isOpen?c:c+"33"}`,borderRadius:isOpen?"12px 12px 0 0":12,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:9,color:c,letterSpacing:3,marginBottom:2}}>👑 ASIGNADA</div>
                    <div style={{fontSize:15,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{rt.name}</div>
                    <div style={{fontSize:10,color:"#555",marginTop:2}}>{rt.sessions?.length||0} sesiones</div>
                  </div>
                  <div style={{fontSize:14,color:c}}>{isOpen?"▲":"▼"}</div>
                </button>
                {isOpen&&(
                  <div style={{border:`1px solid ${c}33`,borderTop:"none",borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
                    {rt.sessions?.map((sess,si)=>{
                      const sk=`${rt.id}-${si}`;
                      const sessOpen=addingTo===sk||openDay===sk;
                      return(
                        <div key={si} style={{borderBottom:"1px solid #1A1A2E"}}>
                          <button onClick={()=>setOpenDay(sessOpen?null:sk)}
                            style={{width:"100%",textAlign:"left",padding:"11px 16px",background:sessOpen?`${c}0D`:"transparent",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div style={{fontSize:12,fontWeight:700,color:sessOpen?c:"#888",fontFamily:"'Rajdhani',sans-serif"}}>{sess.day}</div>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:10,color:"#555"}}>{sess.exercises.filter(e=>e.done).length}/{sess.exercises.length} ✓</span>
                              <span style={{fontSize:12,color:"#444"}}>{sessOpen?"▲":"▼"}</span>
                            </div>
                          </button>
                          {sessOpen&&(
                            <div style={{padding:"0 12px 12px"}}>
                              {sess.exercises.map((ex,ei)=>(
                                <div key={ei} onClick={()=>toggleEx(rt.id,si,ei)}
                                  style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",marginBottom:6,borderRadius:9,background:ex.done?`${c}12`:"#07070F",border:`1px solid ${ex.done?c+"55":"#1A1A2E"}`,cursor:"pointer"}}>
                                  <div style={{width:26,height:26,borderRadius:7,border:`2px solid ${ex.done?c:"#2A2A44"}`,background:ex.done?c:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                    {ex.done&&<span style={{color:"#07070F",fontSize:13,fontWeight:900}}>✓</span>}
                                  </div>
                                  <div style={{flex:1}}>
                                    <div style={{fontSize:13,fontWeight:700,color:ex.done?"#555":"#FFF",textDecoration:ex.done?"line-through":"none",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}</div>
                                    <div style={{fontSize:10,color:"#444"}}>{ex.sets} · {ex.rest}</div>
                                  </div>
                                  <div style={{fontSize:10,color:ex.done?c:"#444",fontWeight:700}}>+{ex.xp||35} XP</div>
                                </div>
                              ))}
                              {addingTo===sk?(
                                <div style={{background:"#0D0D1A",border:`1px solid ${c}33`,borderRadius:10,padding:12,marginTop:8}}>
                                  <div style={{fontSize:9,color:c,letterSpacing:3,marginBottom:8}}>AÑADIR EJERCICIO</div>
                                  <input value={newEx.name} onChange={e=>setNewEx(p=>({...p,name:e.target.value}))}
                                    placeholder="Nombre del ejercicio..." style={{width:"100%",padding:"9px 12px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:12,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:6,boxSizing:"border-box"}}/>
                                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                                    <input value={newEx.sets} onChange={e=>setNewEx(p=>({...p,sets:e.target.value}))} placeholder="3x10" style={{padding:"9px 10px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:12,outline:"none",fontFamily:"'Rajdhani',sans-serif"}}/>
                                    <input value={newEx.rest} onChange={e=>setNewEx(p=>({...p,rest:e.target.value}))} placeholder="60s" style={{padding:"9px 10px",background:"#07070F",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:12,outline:"none",fontFamily:"'Rajdhani',sans-serif"}}/>
                                  </div>
                                  <div style={{display:"flex",gap:8}}>
                                    <button onClick={()=>setDbOpen([rt.id,si])} style={{flex:1,padding:"9px 8px",background:"#60A5FA18",border:"1px solid #60A5FA44",borderRadius:8,color:"#60A5FA",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>📚 Base DB</button>
                                    <button onClick={()=>addExToSession(rt.id,si)} style={{flex:1,padding:"9px 8px",background:`${c}22`,border:`1px solid ${c}44`,borderRadius:8,color:c,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>✚ AÑADIR</button>
                                    <button onClick={()=>setAddingTo(null)} style={{padding:"9px 10px",background:"transparent",border:"1px solid #2A2A44",borderRadius:8,color:"#555",fontSize:11,cursor:"pointer"}}>✕</button>
                                  </div>
                                </div>
                              ):(
                                <button onClick={()=>setAddingTo(sk)} style={{width:"100%",marginTop:8,padding:"9px 0",background:"transparent",border:`1px dashed ${c}44`,borderRadius:9,color:c,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>
                                  + AÑADIR EJERCICIO
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ─── EXERCISE DATABASE VIEW ───────────────────────────────────────────────────
function EjerciciosDB({filter,setFilter,onBack,onPick=null}){
  const lvlColor={Principiante:"#34D399",Intermedio:"#FBBF24",Avanzado:"#F87171"};
  const muscles=["todos",...Object.keys(MUSCLE_DEFS)];
  const levels=["todos","Principiante","Intermedio","Avanzado"];
  const filtered=EXERCISE_DB.filter(e=>{
    const mOk=filter.muscle==="todos"||e.muscle.includes(filter.muscle);
    const lOk=filter.level==="todos"||e.level===filter.level;
    const sOk=!filter.search||e.name.toLowerCase().includes(filter.search.toLowerCase());
    return mOk&&lOk&&sOk;
  });
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#60A5FA",cursor:"pointer",fontSize:22,lineHeight:1}}>←</button>
        <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3}}>BASE DE EJERCICIOS · {EXERCISE_DB.length}</div>
      </div>
      <input placeholder="🔍 Buscar ejercicio..." value={filter.search} onChange={e=>setFilter(p=>({...p,search:e.target.value}))} style={{width:"100%",padding:"10px 14px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:10,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:10}}/>
      <div style={{display:"flex",gap:5,marginBottom:8,overflowX:"auto",paddingBottom:4}}>
        {muscles.map(m=><button key={m} onClick={()=>setFilter(p=>({...p,muscle:m}))} style={{padding:"4px 10px",borderRadius:20,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:10,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",background:filter.muscle===m?"#60A5FA":"#1A1A2E",color:filter.muscle===m?"#07070F":"#555"}}>{m==="todos"?"Todos":MUSCLE_DEFS[m]?.label||m}</button>)}
      </div>
      <div style={{display:"flex",gap:5,marginBottom:12}}>
        {levels.map(l=><button key={l} onClick={()=>setFilter(p=>({...p,level:l}))} style={{padding:"4px 10px",borderRadius:20,border:"none",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",background:filter.level===l?(l==="todos"?"#60A5FA":lvlColor[l]):"#1A1A2E",color:filter.level===l?"#07070F":"#555"}}>{l==="todos"?"Todos":l}</button>)}
      </div>
      <div style={{fontSize:10,color:"#444",marginBottom:10}}>{filtered.length} resultados</div>
      {filtered.map(ex=>(
        <div key={ex.id} style={{background:"#0F0F1C",border:"1px solid #1E1E32",borderRadius:10,padding:"12px 14px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
            <div style={{fontSize:14,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",flex:1}}>{ex.name}</div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0,marginLeft:8}}>
              {onPick&&<button onClick={()=>onPick(ex)} style={{padding:"4px 10px",background:"#34D39922",border:"1px solid #34D39944",borderRadius:7,color:"#34D399",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>+ AÑADIR</button>}
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:20,background:`${lvlColor[ex.level]}22`,border:`1px solid ${lvlColor[ex.level]}44`,color:lvlColor[ex.level]}}>{ex.level}</span>
            </div>
          </div>
          <div style={{fontSize:11,color:"#666",marginBottom:6}}>{ex.desc}</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {ex.muscle.map(m=><span key={m} style={{fontSize:9,padding:"2px 8px",background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:20,color:"#888"}}>{MUSCLE_DEFS[m]?.label||m}</span>)}
            <span style={{fontSize:9,padding:"2px 8px",background:"#1A1A2E",borderRadius:20,color:"#555"}}>📦 {ex.equip}</span>
            <span style={{fontSize:9,padding:"2px 8px",background:"#1A1A2E",borderRadius:20,color:"#F59E0B",fontWeight:700}}>+{ex.xpBase} XP</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ROUTINE BUILDER ─────────────────────────────────────────────────────────
function RoutineBuilder({routine,onSave,onBack,addXp}){
  const COLORS=["#34D399","#60A5FA","#F87171","#FBBF24","#A78BFA","#F4714A"];
  const [name,setName]=useState(routine?.name||"");
  const [color,setColor]=useState(routine?.color||COLORS[0]);
  const [sessions,setSessions]=useState(routine?.sessions||[{day:"Día 1",exercises:[]}]);
  const [activeSess,setActiveSess]=useState(0);
  const [picking,setPicking]=useState(false);
  const [exSearch,setExSearch]=useState("");
  const [exMuscle,setExMuscle]=useState("todos");

  const filtEx=EXERCISE_DB.filter(e=>{
    const mOk=exMuscle==="todos"||e.muscle.includes(exMuscle);
    const sOk=!exSearch||e.name.toLowerCase().includes(exSearch.toLowerCase());
    return mOk&&sOk;
  });

  const addEx=ex=>{ setSessions(p=>p.map((s,i)=>i===activeSess?{...s,exercises:[...s.exercises,{name:ex.name,sets:"3x10",rest:"60s",xp:ex.xpBase,done:false}]}:s)); setPicking(false); setExSearch(""); setExMuscle("todos"); };
  const removeEx=(si,ei)=>setSessions(p=>p.map((s,i)=>i===si?{...s,exercises:s.exercises.filter((_,j)=>j!==ei)}:s));
  const updateEx=(si,ei,f,v)=>setSessions(p=>p.map((s,i)=>i===si?{...s,exercises:s.exercises.map((ex,j)=>j===ei?{...ex,[f]:v}:ex)}:s));
  const toggleDone=(si,ei,xp,evt)=>{ if(!sessions[si].exercises[ei].done){ setSessions(p=>p.map((s,i)=>i===si?{...s,exercises:s.exercises.map((ex,j)=>j===ei?{...ex,done:true}:ex)}:s)); addXp(xp,evt); } };

  const sess=sessions[activeSess]||sessions[0];

  if(picking) return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <button onClick={()=>setPicking(false)} style={{background:"none",border:"none",color:"#34D399",cursor:"pointer",fontSize:22,lineHeight:1}}>←</button>
        <div style={{fontSize:12,fontWeight:700,color:"#34D399",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>AÑADIR EJERCICIO</div>
      </div>
      <input placeholder="🔍 Buscar..." value={exSearch} onChange={e=>setExSearch(e.target.value)} style={{width:"100%",padding:"10px 14px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:10,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:10}}/>
      <div style={{display:"flex",gap:5,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
        {["todos",...Object.keys(MUSCLE_DEFS)].map(m=><button key={m} onClick={()=>setExMuscle(m)} style={{padding:"4px 10px",borderRadius:20,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:10,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",background:exMuscle===m?"#34D399":"#1A1A2E",color:exMuscle===m?"#07070F":"#555"}}>{m==="todos"?"Todos":MUSCLE_DEFS[m]?.label||m}</button>)}
      </div>
      {filtEx.map(ex=>(
        <button key={ex.id} onClick={()=>addEx(ex)} style={{width:"100%",textAlign:"left",background:"#0F0F1C",border:"1px solid #1E1E32",borderRadius:10,padding:"12px 14px",marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}</div><div style={{fontSize:10,color:"#555"}}>{ex.muscle.map(m=>MUSCLE_DEFS[m]?.label||m).join(", ")} · {ex.equip}</div></div>
          <span style={{fontSize:11,color:"#34D399",fontWeight:700,flexShrink:0}}>+{ex.xpBase} XP</span>
        </button>
      ))}
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#34D399",cursor:"pointer",fontSize:22,lineHeight:1}}>←</button>
        <div style={{fontSize:12,fontWeight:700,color:"#34D399",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>{routine?"EDITAR":"NUEVA"} RUTINA</div>
      </div>
      <input placeholder="Nombre de la rutina" value={name} onChange={e=>setName(e.target.value)} style={{width:"100%",padding:"12px 14px",background:"#0D0D1A",border:`1px solid ${color}44`,borderRadius:10,color:"#FFF",fontSize:14,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:10}}/>
      <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center"}}>
        <span style={{fontSize:10,color:"#555",letterSpacing:2}}>COLOR</span>
        {COLORS.map(c=><button key={c} onClick={()=>setColor(c)} style={{width:24,height:24,borderRadius:"50%",background:c,border:`2px solid ${color===c?"#FFF":"transparent"}`,cursor:"pointer"}}/>)}
      </div>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
        {sessions.map((s,i)=>(
          <button key={i} onClick={()=>setActiveSess(i)} style={{padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",background:activeSess===i?color:"#1A1A2E",color:activeSess===i?"#07070F":"#555"}}>{s.day}</button>
        ))}
        <button onClick={()=>{setSessions(p=>[...p,{day:`Día ${p.length+1}`,exercises:[]}]);setActiveSess(sessions.length);}} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${color}44`,background:"transparent",cursor:"pointer",fontSize:11,color:color,fontFamily:"'Rajdhani',sans-serif"}}>+ DÍA</button>
        <button onClick={()=>{
          const blank=sessions.map(s=>({day:s.day,exercises:[]}));
          setSessions(p=>[...p,...blank]);
          setActiveSess(sessions.length);
        }} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${color}44`,background:"transparent",cursor:"pointer",fontSize:11,color:color,fontFamily:"'Rajdhani',sans-serif"}}>+ SEMANA EN BLANCO</button>
      </div>
      <input value={sess.day} onChange={e=>setSessions(p=>p.map((s,i)=>i===activeSess?{...s,day:e.target.value}:s))} style={{width:"100%",padding:"8px 12px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:8,color:"#FFF",fontSize:12,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:10}}/>
      {sess.exercises.length===0
        ? <div style={{textAlign:"center",padding:24,color:"#333",fontSize:12,border:"1px dashed #2A2A44",borderRadius:10,marginBottom:10}}>Sin ejercicios. Añade uno ↓</div>
        : sess.exercises.map((ex,ei)=>(
          <div key={ei} style={{background:ex.boss?"#1A0808":ex.done?`${color}10`:"#0D0D19",border:`1px solid ${ex.boss?"#E84A5F55":color+"22"}`,borderRadius:10,padding:"10px 12px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:ex.done?"#555":"#FFF",textDecoration:ex.done?"line-through":"none",fontFamily:"'Rajdhani',sans-serif"}}>{ex.name}</div>
                {ex.boss&&<span style={{fontSize:8,padding:"1px 7px",background:"#E84A5F22",border:"1px solid #E84A5F66",borderRadius:20,color:"#E84A5F",letterSpacing:1,marginTop:3,display:"inline-block"}}>💀 BOSS</span>}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>updateEx(activeSess,ei,"boss",!ex.boss)} title="Marcar como Boss" style={{width:26,height:26,borderRadius:6,border:`1.5px solid ${ex.boss?"#E84A5F":"#2A2A44"}`,background:ex.boss?"#E84A5F22":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>💀</button>
                <button onClick={e=>toggleDone(activeSess,ei,ex.xp,e)} style={{width:26,height:26,borderRadius:6,border:`1.5px solid ${ex.done?color:"#2A2A44"}`,background:ex.done?color:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:ex.done?"#07070F":"#444"}}>{ex.done?"✓":"○"}</button>
                <button onClick={()=>removeEx(activeSess,ei)} style={{width:26,height:26,borderRadius:6,border:"1px solid #E84A5F33",background:"transparent",cursor:"pointer",fontSize:12,color:"#E84A5F"}}>×</button>
              </div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <input value={ex.sets} onChange={e=>updateEx(activeSess,ei,"sets",e.target.value)} style={{flex:1,padding:"5px 8px",background:"#0A0A12",border:"1px solid #2A2A44",borderRadius:6,color:"#FFF",fontSize:11,outline:"none",fontFamily:"'Rajdhani',sans-serif"}} placeholder="Series"/>
              <input value={ex.rest} onChange={e=>updateEx(activeSess,ei,"rest",e.target.value)} style={{flex:1,padding:"5px 8px",background:"#0A0A12",border:"1px solid #2A2A44",borderRadius:6,color:"#FFF",fontSize:11,outline:"none",fontFamily:"'Rajdhani',sans-serif"}} placeholder="Descanso"/>
              <span style={{fontSize:10,color:ex.boss?"#E84A5F":color,fontWeight:700,padding:"5px 6px",whiteSpace:"nowrap"}}>+{ex.xp}XP</span>
            </div>
          </div>
        ))
      }
      <button onClick={()=>setPicking(true)} style={{width:"100%",padding:12,background:`${color}18`,border:`1px dashed ${color}66`,borderRadius:10,color,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:1,marginBottom:14}}>+ AÑADIR EJERCICIO</button>
      <button onClick={()=>name.trim()&&onSave({id:routine?.id,name,color,sessions,createdAt:routine?.createdAt||Date.now()})} disabled={!name.trim()} style={{width:"100%",padding:14,background:name.trim()?`linear-gradient(135deg,${color},${color}bb)`:"#1A1A2E",border:"none",borderRadius:10,color:name.trim()?"#07070F":"#444",fontSize:14,fontWeight:700,cursor:name.trim()?"pointer":"not-allowed",fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>💾 GUARDAR RUTINA</button>
    </div>
  );
}

// ─── RAID MODAL COMPONENT ────────────────────────────────────────────────────
function RaidModal({raid,startTime,onComplete,onDismiss,onSkip}){
  const c=RAID_RARITY_COLOR[raid.rarity]||"#A78BFA";
  const [tick,setTick]=useState(0);
  useEffect(()=>{
    const iv=setInterval(()=>setTick(t=>t+1),1000);
    return()=>clearInterval(iv);
  },[]);
  const elapsed=Math.floor((Date.now()-startTime)/1000);
  const remaining=Math.max(0,raid.time-elapsed);
  const hours=Math.floor(remaining/3600);
  const mins=Math.floor((remaining%3600)/60);
  const secs=remaining%60;
  const pct=remaining/raid.time; // 1→0
  const isUrgent=remaining<3600; // last hour
  const circumference=2*Math.PI*54;
  const dashOffset=circumference*(1-pct);

  return(
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",
      background:"radial-gradient(ellipse at center, #1a000a 0%, #000000 70%)"}}>
      {/* Animated background particles */}
      <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none"}}>
        {[...Array(12)].map((_,i)=>(
          <div key={i} style={{
            position:"absolute",
            left:`${(i*31)%100}%`,top:`${(i*17+10)%100}%`,
            width:i%3===0?3:2,height:i%3===0?3:2,
            borderRadius:"50%",background:c,opacity:0.3+(i%4)*0.1,
            animation:`float${i%3} ${3+i%4}s ease-in-out infinite`,
            animationDelay:`${i*0.4}s`
          }}/>
        ))}
      </div>

      <div style={{width:"100%",maxWidth:380,position:"relative"}}>
        {/* Glow border card */}
        <div style={{background:"linear-gradient(180deg,#0D0007 0%,#07070F 100%)",
          borderRadius:24,border:`1px solid ${c}88`,
          boxShadow:`0 0 60px ${c}44, inset 0 0 40px ${c}08`,
          overflow:"hidden"}}>

          {/* TOP BANNER */}
          <div style={{background:`linear-gradient(135deg,${c}44 0%,${c}11 60%,transparent 100%)`,
            padding:"28px 24px 20px",textAlign:"center",position:"relative"}}>
            {/* Rarity line */}
            <div style={{fontSize:8,letterSpacing:5,color:c,marginBottom:10,fontFamily:"'Rajdhani',sans-serif",opacity:0.8}}>
              ━━ {raid.rarity.toUpperCase()} RAID ━━
            </div>
            {/* Boss icon — pulsing */}
            <div style={{fontSize:72,lineHeight:1,marginBottom:12,
              filter:`drop-shadow(0 0 20px ${c}) drop-shadow(0 0 40px ${c}88)`,
              animation:"bossGlow 1.5s ease-in-out infinite"}}>
              {raid.icon}
            </div>
            {/* Boss name */}
            <div style={{fontSize:24,fontWeight:900,color:"#FFF",
              fontFamily:"'Cinzel',serif",lineHeight:1.2,marginBottom:6,
              textShadow:`0 0 20px ${c}88`}}>
              {raid.boss}
            </div>
            <div style={{fontSize:11,color:"#AAA",fontStyle:"italic",lineHeight:1.5,
              fontFamily:"'Rajdhani',sans-serif"}}>
              "{raid.desc}"
            </div>
          </div>

          {/* COUNTDOWN */}
          <div style={{padding:"20px 24px 0",textAlign:"center"}}>
            <div style={{fontSize:9,color:"#555",letterSpacing:4,marginBottom:12,fontFamily:"'Rajdhani',sans-serif"}}>
              TIEMPO RESTANTE
            </div>
            {/* SVG circular countdown */}
            <div style={{position:"relative",width:130,height:130,margin:"0 auto 16px"}}>
              <svg width="130" height="130" style={{transform:"rotate(-90deg)"}}>
                {/* Track */}
                <circle cx="65" cy="65" r="54" fill="none" stroke="#1A1A2E" strokeWidth="6"/>
                {/* Progress */}
                <circle cx="65" cy="65" r="54" fill="none" stroke={isUrgent?"#E84A5F":c}
                  strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{transition:"stroke-dashoffset 1s linear",filter:`drop-shadow(0 0 6px ${isUrgent?"#E84A5F":c})`}}/>
              </svg>
              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
                alignItems:"center",justifyContent:"center"}}>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:900,lineHeight:1,
                  color:isUrgent?"#E84A5F":"#FFF",
                  fontSize:remaining<60?28:22}}>
                  {remaining<60
                    ?`${secs}s`
                    :`${hours.toString().padStart(2,"0")}:${mins.toString().padStart(2,"0")}:${secs.toString().padStart(2,"0")}`}
                </div>
                {remaining>=60&&<div style={{fontSize:8,color:"#555",letterSpacing:2,marginTop:2}}>HH:MM:SS</div>}
                {isUrgent&&<div style={{fontSize:8,color:"#E84A5F",letterSpacing:2,marginTop:2,animation:"bossGlow 1s infinite"}}>¡URGENTE!</div>}
              </div>
            </div>

            {/* Challenge box */}
            <div style={{background:`${c}0D`,border:`1px solid ${c}44`,borderRadius:14,
              padding:"14px 16px",marginBottom:16,
              boxShadow:`inset 0 0 20px ${c}08`}}>
              <div style={{fontSize:8,color:c,letterSpacing:4,marginBottom:8,fontFamily:"'Rajdhani',sans-serif"}}>⚔️ TU MISIÓN</div>
              <div style={{fontSize:20,fontWeight:900,color:"#FFF",
                fontFamily:"'Rajdhani',sans-serif",letterSpacing:1,lineHeight:1.3}}>
                {raid.challenge}
              </div>
            </div>

            {/* Rewards row */}
            <div style={{display:"flex",gap:8,marginBottom:20}}>
              {[
                {l:"XP",v:`+${raid.xp}`,col:"#A78BFA",icon:"⚡"},
                {l:"MONEDAS",v:`+${raid.coins}`,col:"#F59E0B",icon:"🪙"},
              ].map(r=>(
                <div key={r.l} style={{flex:1,background:"#0A0A14",borderRadius:12,
                  padding:"12px 8px",textAlign:"center",
                  border:`1px solid ${r.col}33`,
                  boxShadow:`0 0 12px ${r.col}11`}}>
                  <div style={{fontSize:11,marginBottom:4}}>{r.icon}</div>
                  <div style={{fontSize:18,fontWeight:900,color:r.col,
                    fontFamily:"'Rajdhani',sans-serif",lineHeight:1}}>{r.v}</div>
                  <div style={{fontSize:8,color:"#444",letterSpacing:1,marginTop:3}}>{r.l}</div>
                </div>
              ))}
            </div>

            {/* Buttons */}
            <button onClick={onComplete}
              style={{width:"100%",padding:"16px",marginBottom:10,
                background:`linear-gradient(135deg,${c} 0%,${c}BB 100%)`,
                border:"none",borderRadius:14,
                color:"#07070F",fontSize:15,fontWeight:900,cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif",letterSpacing:3,
                boxShadow:`0 4px 24px ${c}66`,
                textTransform:"uppercase"}}>
              ⚔️ ¡RAID COMPLETADA!
            </button>
            <div style={{display:"flex",gap:8,marginBottom:20}}>
              <button onClick={onDismiss}
                style={{flex:2,padding:"12px",
                  background:"transparent",border:"1px solid #2A2A3E",
                  borderRadius:14,color:"#444",fontSize:11,cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif",letterSpacing:2}}>
                CERRAR · SIGUE ACTIVA
              </button>
              <button onClick={onSkip}
                style={{flex:1,padding:"12px",
                  background:"#E84A5F11",border:"1px solid #E84A5F44",
                  borderRadius:14,color:"#E84A5F",fontSize:11,cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif",letterSpacing:1}}>
                ABANDONAR
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── EX HISTORY MODAL ────────────────────────────────────────────────────────
function ExHistoryModal({exName,history,onClose,color="#A78BFA"}){
  const sorted=[...history].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const maxKg=sorted.length>0?Math.max(...sorted.map(r=>r.kg)):0;
  const minKg=sorted.length>0?Math.min(...sorted.map(r=>r.kg)):0;
  const range=maxKg-minKg||1;
  const pr=maxKg;

  const formatDate=iso=>{
    if(!iso) return "";
    const d=new Date(iso);
    return `${d.getDate().toString().padStart(2,"0")}/${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getFullYear()}`;
  };

  return(
    <div style={{position:"fixed",inset:0,background:"#000000EE",zIndex:300,display:"flex",alignItems:"flex-end"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxHeight:"85vh",background:"#0D0D1A",borderRadius:"20px 20px 0 0",border:"1px solid #1E1E32",display:"flex",flexDirection:"column"}}>
        {/* Header */}
        <div style={{padding:"20px 20px 12px",borderBottom:"1px solid #1A1A2E",flexShrink:0}}>
          <div style={{fontSize:9,color:color,letterSpacing:3,marginBottom:4}}>📈 HISTÓRICO GLOBAL</div>
          <div style={{fontSize:18,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",marginBottom:8}}>{exName}</div>
          <div style={{display:"flex",gap:10}}>
            {[{l:"SESIONES",v:sorted.length},{l:"RÉCORD",v:`${pr}kg`},{l:"ÚLTIMA",v:sorted.length>0?`${sorted[sorted.length-1].kg}kg`:"—"}].map(s=>(
              <div key={s.l} style={{flex:1,background:"#07070F",borderRadius:8,padding:"8px 6px",textAlign:"center",border:`1px solid ${color}22`}}>
                <div style={{fontSize:14,fontWeight:700,color:color,fontFamily:"'Rajdhani',sans-serif"}}>{s.v}</div>
                <div style={{fontSize:8,color:"#444",letterSpacing:1}}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart */}
        {sorted.length>=2&&(
          <div style={{padding:"16px 20px 8px",flexShrink:0}}>
            <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:8}}>PROGRESIÓN DE PESO</div>
            <div style={{position:"relative",height:80,display:"flex",alignItems:"flex-end",gap:3}}>
              {sorted.map((r,i)=>{
                const h=Math.max(8,((r.kg-minKg)/range)*70+10);
                const isPR=r.kg===maxKg;
                return(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                    {isPR&&<div style={{fontSize:7,color:"#F59E0B"}}>PR</div>}
                    <div style={{width:"100%",borderRadius:"3px 3px 0 0",background:isPR?`#F59E0B`:color,opacity:0.7+(i/sorted.length)*0.3,height:h,transition:"height .3s"}}/>
                    <div style={{fontSize:8,color:"#555",writingMode:"vertical-lr",transform:"rotate(180deg)",lineHeight:1}}>{r.kg}kg</div>
                  </div>
                );
              })}
              {/* PR line */}
              <div style={{position:"absolute",top:2,left:0,right:0,height:1,background:"#F59E0B44",borderTop:"1px dashed #F59E0B44"}}/>
            </div>
          </div>
        )}

        {/* List */}
        <div style={{overflowY:"auto",flex:1,padding:"8px 20px 20px"}}>
          <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:8}}>TODOS LOS REGISTROS</div>
          {sorted.length===0&&<div style={{textAlign:"center",padding:"30px",color:"#333",fontSize:12}}>Sin registros aún</div>}
          {[...sorted].reverse().map((r,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #1A1A2E"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:r.kg===maxKg?"#F59E0B":"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{r.kg} kg {r.kg===maxKg&&"🏆"}</div>
                <div style={{fontSize:10,color:"#444"}}>{formatDate(r.date)}</div>
              </div>
              <div style={{fontSize:10,color:"#555",fontFamily:"'Rajdhani',sans-serif"}}>
                {i===0?"ÚLTIMA":`hace ${sorted.length-1-([...sorted].reverse().indexOf(r))+1} sesiones`}
              </div>
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{margin:"0 20px 20px",padding:"12px",background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:10,color:"#666",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:12,letterSpacing:2,flexShrink:0}}>CERRAR</button>
      </div>
    </div>
  );
}


// ─── BUZÓN TAB ────────────────────────────────────────────────────────────────
function BuzonTab({messages,onSend,userName}){
  const [input,setInput]=useState("");
  const bottomRef=useRef(null);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const handleSend=()=>{if(!input.trim())return;onSend(input);setInput("");};

  const formatDate=iso=>{
    if(!iso)return"";
    const d=new Date(iso);
    const today=new Date();
    const isToday=d.toDateString()===today.toDateString();
    if(isToday) return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
    return `${d.getDate()}/${d.getMonth()+1} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
  };

  return(
    <div style={{display:"flex",flexDirection:"column",height:"calc(100dvh - 220px)"}}>
      <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:12}}>✉️ BUZÓN · CHAT CON ENTRENADOR</div>
      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,paddingBottom:8}}>
        {messages.length===0&&(
          <div style={{textAlign:"center",padding:"60px 20px",color:"#333"}}>
            <div style={{fontSize:40,marginBottom:10}}>💬</div>
            <div style={{fontSize:13,fontWeight:700,color:"#444",fontFamily:"'Cinzel',serif",marginBottom:6}}>Sin mensajes aún</div>
            <div style={{fontSize:11,color:"#333"}}>Escríbele a tu entrenador. Te responderá pronto.</div>
          </div>
        )}
        {messages.map((m,i)=>{
          const isUser=m.from==="user";
          return(
            <div key={m.id||i} style={{display:"flex",justifyContent:isUser?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"80%",padding:"10px 14px",borderRadius:isUser?"16px 16px 4px 16px":"16px 16px 16px 4px",
                background:isUser?"linear-gradient(135deg,#A78BFA,#7C3AED)":"#0F0F1C",
                border:isUser?"none":"1px solid #1E1E32",
                boxShadow:isUser?"0 0 12px #A78BFA44":"none"}}>
                {!isUser&&<div style={{fontSize:9,color:"#A78BFA",letterSpacing:2,marginBottom:4,fontFamily:"'Rajdhani',sans-serif"}}>🏋️ ENTRENADOR</div>}
                <div style={{fontSize:13,color:"#FFF",lineHeight:1.5,fontFamily:"'Rajdhani',sans-serif"}}>{m.text}</div>
                <div style={{fontSize:9,color:isUser?"#C4B5FD":"#444",marginTop:4,textAlign:"right"}}>{formatDate(m.date)}{isUser&&m.read?" ✓✓":isUser?" ✓":""}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>
      {/* Input */}
      <div style={{display:"flex",gap:8,paddingTop:10,borderTop:"1px solid #1A1A2E",flexShrink:0}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend();}}}
          placeholder="Escribe tu mensaje..."
          style={{flex:1,padding:"10px 14px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:12,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",resize:"none",lineHeight:1.4}}
          rows={2}/>
        <button onClick={handleSend} disabled={!input.trim()}
          style={{padding:"0 16px",background:input.trim()?"linear-gradient(135deg,#A78BFA,#7C3AED)":"#1A1A2E",border:"none",borderRadius:12,color:input.trim()?"#FFF":"#444",fontSize:18,cursor:input.trim()?"pointer":"not-allowed",flexShrink:0}}>
          ➤
        </button>
      </div>
    </div>
  );
}


// ─── CUERPO TAB ───────────────────────────────────────────────────────────────
function CuerpoTab({mxp,sex="M"}){
  const allXP=Object.values(mxp).reduce((a,b)=>a+b,0);
  const activated=Object.values(mxp).filter(v=>v>0).length;
  const frontList=["pecho","hombros","biceps","antebrazos","abdomen","piernas","cardio"];
  const backList=["espalda","hombros","triceps","antebrazos","gluteos","piernas","gemelos"];
  const allMuscles=Object.keys(MUSCLE_DEFS);
  return(
    <div>
      {/* Global stat */}
      <div style={{padding:"14px 16px",background:"linear-gradient(135deg,#0D0D1A,#080810)",border:"1px solid #0AF5FF33",borderRadius:14,marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:44,height:44,borderRadius:12,border:"2px solid #0AF5FF",display:"flex",alignItems:"center",justifyContent:"center",background:"#0AF5FF11",boxShadow:"0 0 20px #0AF5FF44",flexShrink:0,fontSize:22}}>🫀</div>
        <div>
          <div style={{fontSize:9,color:"#0AF5FF",letterSpacing:4,marginBottom:3}}>ESTADO FÍSICO GLOBAL</div>
          <div style={{fontSize:18,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{allXP} XP musculares</div>
          <div style={{fontSize:11,color:"#0AF5FF"}}>{activated} / {allMuscles.length} grupos activados</div>
        </div>
      </div>

      {/* Muscle rank cards — all groups, full width */}
      <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:10}}>RANGOS MUSCULARES</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
        {allMuscles.map(id=>{
          const xp=mxp[id]||0;
          const mr=getMR(xp);
          const next=getNextMR(xp);
          const pct=next?Math.min(((xp-mr.min)/(next.min-mr.min))*100,100):100;
          const def=MUSCLE_DEFS[id];
          return(
            <div key={id} style={{background:"#0D0D1A",border:`1px solid ${mr.color}44`,borderRadius:12,padding:12,position:"relative",overflow:"hidden"}}>
              {/* rank glow bg */}
              <div style={{position:"absolute",top:-10,right:-10,width:60,height:60,borderRadius:"50%",background:`${mr.color}08`,pointerEvents:"none"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",letterSpacing:1}}>{def.label.toUpperCase()}</div>
                  <div style={{fontSize:9,color:mr.color,marginTop:1}}>{mr.label}</div>
                </div>
                <div style={{width:30,height:30,borderRadius:8,border:`2px solid ${mr.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:mr.color,fontFamily:"'Cinzel',serif",background:`${mr.color}22`,boxShadow:`0 0 12px ${mr.glow}`,flexShrink:0}}>
                  {mr.rank}
                </div>
              </div>
              <div style={{height:5,background:"#1A1A2E",borderRadius:3,overflow:"hidden",marginBottom:5}}>
                <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${mr.color}88,${mr.color})`,borderRadius:3,boxShadow:`0 0 6px ${mr.color}`,transition:"width .6s ease"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9}}>
                <span style={{color:"#555"}}>{xp} XP</span>
                <span style={{color:next?mr.color:"#F59E0B"}}>{next?`→ ${next.min} ${next.rank}`:"🏆 MAX"}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{background:"#0D0D1A",border:"1px solid #1E1E32",borderRadius:12,padding:14}}>
        <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:12}}>ESCALA DE RANGOS MUSCULARES</div>
        {MUSCLE_RANKS.slice(1).map(mr=>(
          <div key={mr.rank} style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
            <div style={{width:24,height:24,borderRadius:6,border:`1.5px solid ${mr.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:mr.color,fontFamily:"'Cinzel',serif",background:`${mr.color}22`,flexShrink:0}}>{mr.rank}</div>
            <div style={{flex:1,fontSize:11,color:"#888",fontFamily:"'Rajdhani',sans-serif"}}>{mr.label}</div>
            <div style={{fontSize:10,color:"#444"}}>{mr.min} XP</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TIENDA TAB ───────────────────────────────────────────────────────────────
function TiendaTab({coins,redeemed,dc,onRedeem}){
  const [view,setView]=useState("tienda"); // "tienda" | "historial"
  const cats=[...new Set(REWARDS.map(r=>r.cat))];
  const dungeons=Object.keys(dc).filter(k=>!k.startsWith("week_")&&!k.startsWith("phase_")).length;
  const weeks=Object.keys(dc).filter(k=>k.startsWith("week_")).length;
  const phases=Object.keys(dc).filter(k=>k.startsWith("phase_")).length;
  // Normalize redeemed — support both old (string IDs) and new (objects)
  const redeemedObjs=redeemed.map(e=>typeof e==="object"?e:{id:e,name:REWARDS.find(r=>r.id===e)?.name||e,icon:REWARDS.find(r=>r.id===e)?.icon||"🪙",cost:REWARDS.find(r=>r.id===e)?.cost||0,date:null});
  const totalSpent=redeemedObjs.reduce((a,e)=>a+(e.cost||0),0);
  // Sort history newest first
  const history=[...redeemedObjs].reverse();

  const formatDate=iso=>{
    if(!iso) return "—";
    const d=new Date(iso);
    return `${d.getDate().toString().padStart(2,"0")}/${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getFullYear()} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
  };

  return(
    <div>
      {/* Tab switcher */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[{id:"tienda",l:"🪙 TIENDA"},{id:"historial",l:"📜 HISTORIAL"}].map(t=>(
          <button key={t.id} onClick={()=>setView(t.id)}
            style={{flex:1,padding:"9px 4px",borderRadius:10,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:11,fontWeight:700,letterSpacing:2,
              background:view===t.id?"linear-gradient(135deg,#1A1200,#0D0D1A)":"#0A0A12",
              border:`1px solid ${view===t.id?"#F59E0B66":"#1A1A2E"}`,
              color:view===t.id?"#F59E0B":"#444",
              boxShadow:view===t.id?"0 0 12px #F59E0B22":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* Wallet card — always visible */}
      <div style={{background:"linear-gradient(135deg,#1A1200,#0D0D1A)",border:"1px solid #F59E0B66",borderRadius:16,padding:20,marginBottom:14,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,fontSize:80,opacity:.05}}>🪙</div>
        <div style={{fontSize:9,letterSpacing:4,color:"#F59E0B88",marginBottom:6}}>MONEDERO RANKUP</div>
        <div style={{fontSize:44,fontWeight:900,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif",lineHeight:1,textShadow:"0 0 20px #F59E0B88"}}>{coins.toLocaleString()}</div>
        <div style={{fontSize:12,color:"#A07820",marginTop:4}}>monedas disponibles</div>
        <div style={{display:"flex",gap:14,marginTop:14,paddingTop:14,borderTop:"1px solid #F59E0B22"}}>
          {[{l:"DUNGEONS",v:dungeons},{l:"SEMANAS",v:weeks},{l:"FASES",v:phases},{l:"CANJEADAS",v:redeemed.length},{l:"GASTADAS",v:totalSpent.toLocaleString()+"🪙"}].map(s=>(
            <div key={s.l} style={{textAlign:"center",flex:1}}>
              <div style={{fontSize:s.l==="GASTADAS"?12:16,fontWeight:700,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif"}}>{s.v}</div>
              <div style={{fontSize:9,color:"#555",letterSpacing:1}}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {view==="tienda"&&(
        <>
          <div style={{background:"#0D0D1A",border:"1px solid #F59E0B22",borderRadius:12,padding:14,marginBottom:16}}>
            <div style={{fontSize:9,color:"#F59E0B88",letterSpacing:3,marginBottom:10}}>CÓMO GANAR MONEDAS</div>
            {[{icon:"⚔️",l:"Dungeon completado",c:COIN_DUNGEON},{icon:"💀",l:"Bonus BOSS",c:COIN_BOSS_EX},{icon:"🗓️",l:"Semana completa",c:COIN_WEEK},{icon:"🏰",l:"Fase completa",c:COIN_PHASE}].map(e=>(
              <div key={e.l} style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
                <span style={{fontSize:15}}>{e.icon}</span>
                <span style={{flex:1,fontSize:12,color:"#888",fontFamily:"'Rajdhani',sans-serif"}}>{e.l}</span>
                <span style={{fontSize:13,fontWeight:700,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif"}}>+{e.c} 🪙</span>
              </div>
            ))}
          </div>
          {cats.map(cat=>(
            <div key={cat}>
              <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,margin:"16px 0 10px"}}>{cat.toUpperCase()}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {REWARDS.filter(r=>r.cat===cat).map(reward=>{
                  const can=coins>=reward.cost;
                  const times=redeemedObjs.filter(e=>e.id===reward.id).length;
                  return(
                    <div key={reward.id} style={{background:can?"#0F0F1C":"#0A0A12",border:`1px solid ${can?"#F59E0B33":"#1A1A2E"}`,borderRadius:12,padding:14,position:"relative",opacity:can?1:.55,boxShadow:can?"0 0 12px #F59E0B11":"none"}}>
                      {times>0&&<div style={{position:"absolute",top:8,right:8,background:"#F59E0B",color:"#07070F",fontSize:9,fontWeight:900,borderRadius:20,padding:"2px 7px",fontFamily:"'Rajdhani',sans-serif"}}>×{times}</div>}
                      <div style={{fontSize:30,marginBottom:6}}>{reward.icon}</div>
                      <div style={{fontSize:12,fontWeight:700,color:can?"#FFF":"#555",fontFamily:"'Rajdhani',sans-serif",lineHeight:1.2,marginBottom:4}}>{reward.name}</div>
                      <div style={{fontSize:10,color:"#555",lineHeight:1.4,marginBottom:10}}>{reward.desc}</div>
                      <button onClick={()=>can&&onRedeem(reward)} disabled={!can}
                        style={{width:"100%",padding:8,borderRadius:8,border:"none",fontFamily:"'Rajdhani',sans-serif",fontSize:12,fontWeight:700,cursor:can?"pointer":"not-allowed",
                          background:can?"linear-gradient(135deg,#F59E0B,#D97706)":"#1A1A2E",
                          color:can?"#07070F":"#444",boxShadow:can?"0 0 12px #F59E0B44":"none"}}>
                        🪙 {reward.cost.toLocaleString()}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {view==="historial"&&(
        <div>
          {history.length===0?(
            <div style={{textAlign:"center",padding:"60px 20px",color:"#333"}}>
              <div style={{fontSize:48,marginBottom:12}}>🛒</div>
              <div style={{fontSize:14,fontWeight:700,color:"#444",fontFamily:"'Cinzel',serif",marginBottom:6}}>Sin compras aún</div>
              <div style={{fontSize:12,color:"#333"}}>Completa dungeons y gana monedas para canjear recompensas.</div>
            </div>
          ):(
            <>
              {/* Summary */}
              <div style={{background:"#0D0D1A",border:"1px solid #F59E0B22",borderRadius:12,padding:14,marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:9,color:"#555",letterSpacing:3,marginBottom:4}}>RESUMEN DE COMPRAS</div>
                  <div style={{fontSize:13,color:"#FFF",fontFamily:"'Rajdhani',sans-serif"}}>{redeemed.length} compras realizadas</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,color:"#555",letterSpacing:2,marginBottom:4}}>TOTAL GASTADO</div>
                  <div style={{fontSize:20,fontWeight:700,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif"}}>{totalSpent.toLocaleString()} 🪙</div>
                </div>
              </div>
              {/* History list */}
              {history.map((entry,i)=>(
                <div key={i} style={{background:"#0A0A12",border:"1px solid #1A1A2E",borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
                  <div style={{fontSize:28,flexShrink:0}}>{entry.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",marginBottom:2}}>{entry.name}</div>
                    <div style={{fontSize:10,color:"#444"}}>{formatDate(entry.date)}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#F59E0B",fontFamily:"'Rajdhani',sans-serif"}}>-{(entry.cost||0).toLocaleString()}</div>
                    <div style={{fontSize:9,color:"#555"}}>🪙 monedas</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      <div style={{height:20}}/>
    </div>
  );
}

// ─── NUTRICION TAB ────────────────────────────────────────────────────────────
// ─── ALIMENTOS DB ─────────────────────────────────────────────────────────────
function AlimentosDB({onBack}){
  const [cat,setCat]=useState("todos");
  const [goal,setGoal]=useState("todos");
  const [q,setQ]=useState("");
  const [sel,setSel]=useState(null);

  const filtered=FOOD_DB.filter(f=>
    (cat==="todos"||f.cat===cat)&&
    (goal==="todos"||f.goal.includes(goal))&&
    (!q||f.name.toLowerCase().includes(q.toLowerCase())||f.desc.toLowerCase().includes(q.toLowerCase()))
  );

  const MacroBadge=({label,val,unit,color})=>(
    <div style={{textAlign:"center",background:`${color}14`,border:`1px solid ${color}33`,borderRadius:8,padding:"6px 10px",flex:1}}>
      <div style={{fontSize:16,fontWeight:700,color,fontFamily:"'Rajdhani',sans-serif"}}>{val}<span style={{fontSize:10}}>{unit}</span></div>
      <div style={{fontSize:8,color:"#555",letterSpacing:2}}>{label}</div>
    </div>
  );

  if(sel){
    const c=GOAL_COLORS[sel.goal?.[0]]||"#A78BFA";
    return(
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <button onClick={()=>setSel(null)} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#A78BFA",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
          <div style={{fontSize:9,color:"#444",letterSpacing:3}}>FICHA NUTRICIONAL</div>
        </div>
        <div style={{background:"#0F0F1C",border:`1px solid ${c}33`,borderRadius:14,padding:18,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:9,color:"#555",letterSpacing:2,marginBottom:4}}>{CAT_LABELS[sel.cat]}</div>
              <div style={{fontSize:18,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",lineHeight:1.2,marginBottom:6}}>{sel.name}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {sel.goal.map(g=><span key={g} style={{fontSize:9,padding:"2px 8px",background:`${GOAL_COLORS[g]}18`,border:`1px solid ${GOAL_COLORS[g]}44`,borderRadius:20,color:GOAL_COLORS[g],letterSpacing:1}}>{GOAL_LABELS[g]}</span>)}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:24,fontWeight:900,color:c,fontFamily:"'Rajdhani',sans-serif"}}>{sel.kcal}</div>
              <div style={{fontSize:9,color:"#555",letterSpacing:2}}>KCAL</div>
              <div style={{fontSize:10,color:"#444",marginTop:4}}>⏱ {sel.prep}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <MacroBadge label="PROTEÍNA" val={sel.protein} unit="g" color="#F87171"/>
            <MacroBadge label="CARBOS"   val={sel.carbs}   unit="g" color="#FBBF24"/>
            <MacroBadge label="GRASA"    val={sel.fat}     unit="g" color="#60A5FA"/>
          </div>
          <div style={{fontSize:12,color:"#777",lineHeight:1.6,borderTop:"1px solid #1A1A2E",paddingTop:10}}>{sel.desc}</div>
        </div>
      </div>
    );
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <button onClick={onBack} style={{background:"#1A1A2E",border:"1px solid #2A2A44",borderRadius:8,color:"#34D399",padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>← VOLVER</button>
        <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Cinzel',serif"}}>BASE DE ALIMENTOS</div>
        <div style={{marginLeft:"auto",fontSize:10,color:"#444"}}>{filtered.length} resultados</div>
      </div>

      {/* Search */}
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="🔍 Buscar alimento..." style={{width:"100%",padding:"11px 14px",background:"#0D0D1A",border:"1px solid #2A2A44",borderRadius:10,color:"#FFF",fontSize:13,outline:"none",fontFamily:"'Rajdhani',sans-serif",marginBottom:10,boxSizing:"border-box"}}/>

      {/* Category filter */}
      <div style={{display:"flex",gap:6,marginBottom:8,overflowX:"auto",paddingBottom:2}}>
        {FOOD_CATS.map(c=>(
          <button key={c} onClick={()=>setCat(c)} style={{padding:"6px 12px",borderRadius:20,cursor:"pointer",background:cat===c?"#34D39922":"transparent",border:`1px solid ${cat===c?"#34D399":"#2A2A44"}`,color:cat===c?"#34D399":"#555",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
            {c==="todos"?"📋 Todos":CAT_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Goal filter */}
      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
        {FOOD_GOALS.map(g=>{
          const color=GOAL_COLORS[g]||"#A78BFA";
          return(
            <button key={g} onClick={()=>setGoal(g)} style={{padding:"6px 12px",borderRadius:20,cursor:"pointer",background:goal===g?`${color}22`:"transparent",border:`1px solid ${goal===g?color:"#2A2A44"}`,color:goal===g?color:"#555",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
              {g==="todos"?"🎯 Todos":GOAL_LABELS[g]}
            </button>
          );
        })}
      </div>

      {/* List */}
      {filtered.length===0
        ? <div style={{textAlign:"center",padding:"40px 20px",color:"#333",fontSize:12}}>Sin resultados para "{q}"</div>
        : filtered.map(f=>{
            const c=GOAL_COLORS[f.goal?.[0]]||"#A78BFA";
            return(
              <div key={f.id} onClick={()=>setSel(f)} style={{background:"#0F0F1C",border:`1px solid ${c}22`,borderRadius:11,padding:"12px 14px",marginBottom:8,cursor:"pointer",display:"flex",alignItems:"center",gap:12,transition:"border-color .15s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=c+"55"}
                onMouseLeave={e=>e.currentTarget.style.borderColor=c+"22"}>
                <div style={{fontSize:22,flexShrink:0}}>{f.cat==="plato"?"🍽️":f.cat==="bebida"?"🥤":f.cat==="snack"?"🥜":"🍮"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#FFF",fontFamily:"'Rajdhani',sans-serif",marginBottom:3}}>{f.name}</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:10,color:"#FBBF24",fontWeight:700}}>{f.kcal} kcal</span>
                    <span style={{fontSize:10,color:"#F87171"}}>P: {f.protein}g</span>
                    <span style={{fontSize:10,color:"#FBBF24"}}>C: {f.carbs}g</span>
                    <span style={{fontSize:10,color:"#60A5FA"}}>G: {f.fat}g</span>
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  {f.goal.map(g=><div key={g} style={{fontSize:9,padding:"2px 6px",background:`${GOAL_COLORS[g]}18`,border:`1px solid ${GOAL_COLORS[g]}33`,borderRadius:20,color:GOAL_COLORS[g],marginBottom:3,whiteSpace:"nowrap"}}>{GOAL_LABELS[g]}</div>)}
                  <div style={{fontSize:9,color:"#333",marginTop:2}}>⏱ {f.prep}</div>
                </div>
              </div>
            );
          })
      }
    </div>
  );
}

function NutricionTab({ph, assignedDiets=[]}){
  const [selDiet,setSelDiet]=useState(null);
  const [showDB,setShowDB]=useState(false);
  const activeDiet=selDiet?assignedDiets.find(d=>d.id===selDiet):null;
  const displayColor=activeDiet?activeDiet.color:ph.color;

  if(showDB) return <AlimentosDB onBack={()=>setShowDB(false)}/>;

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3}}>SISTEMA DE SUMINISTROS</div>
        <button onClick={()=>setShowDB(true)} style={{padding:"7px 12px",background:"#34D39922",border:"1px solid #34D39944",borderRadius:8,color:"#34D399",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>🥗 BASE DE ALIMENTOS</button>
      </div>

      {/* Diet selector if assigned diets exist */}
      {assignedDiets.length>0&&(
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,color:"#34D399",letterSpacing:3,marginBottom:8}}>👑 DIETAS PERSONALIZADAS</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
            <button onClick={()=>setSelDiet(null)}
              style={{padding:"7px 12px",borderRadius:8,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:11,fontWeight:700,background:!selDiet?"#A78BFA22":"transparent",border:`1px solid ${!selDiet?"#A78BFA":"#2A2A44"}`,color:!selDiet?"#A78BFA":"#555"}}>
              📋 Fase {ph.id}
            </button>
            {assignedDiets.map(d=>(
              <button key={d.id} onClick={()=>setSelDiet(d.id)}
                style={{padding:"7px 12px",borderRadius:8,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:11,fontWeight:700,background:selDiet===d.id?`${d.color}22`:"transparent",border:`1px solid ${selDiet===d.id?d.color:"#2A2A44"}`,color:selDiet===d.id?d.color:"#555"}}>
                🥗 {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Macros card */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12,padding:16,background:"#0F0F1C",borderRadius:12,border:`1px solid ${displayColor}33`}}>
        <div>
          <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:4}}>CALORÍAS</div>
          <div style={{fontSize:12,color:"#FFF",fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>{activeDiet?activeDiet.calories||"—":ph.nutrition.calories}</div>
        </div>
        <div>
          <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:4}}>PROTEÍNA</div>
          <div style={{fontSize:13,color:displayColor,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>{activeDiet?activeDiet.protein||"—":ph.nutrition.protein}</div>
        </div>
        {activeDiet?.goal&&(
          <div style={{gridColumn:"1/-1"}}>
            <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:4}}>OBJETIVO</div>
            <div style={{fontSize:12,color:displayColor,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>{activeDiet.goal}</div>
          </div>
        )}
      </div>

      {/* Meals */}
      {(activeDiet?activeDiet.meals:ph.nutrition.meals).map((m,i)=>(
        <div key={i} style={{display:"flex",gap:12,padding:14,marginBottom:8,background:"#0F0F1C",borderRadius:10,border:"1px solid #1E1E32",alignItems:"flex-start"}}>
          <div style={{minWidth:44,fontSize:12,color:displayColor,fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>{m.time}</div>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#FFF",marginBottom:3,fontFamily:"'Rajdhani',sans-serif"}}>{m.name}</div>
            <div style={{fontSize:11,color:"#666",lineHeight:1.6}}>{activeDiet?m.desc:m.ex}</div>
          </div>
        </div>
      ))}

      {/* Tips */}
      {((activeDiet?activeDiet.tips:ph.nutrition.tips)||[]).filter(t=>t).length>0&&(
        <div style={{background:"#0F0F1C",borderRadius:10,padding:16,border:"1px solid #1E1E32",marginTop:4}}>
          <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:12}}>REGLAS DEL SISTEMA</div>
          {(activeDiet?activeDiet.tips:ph.nutrition.tips).filter(t=>t).map((tip,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
              <span style={{color:displayColor,fontSize:14,flexShrink:0}}>▸</span>
              <span style={{fontSize:12,color:"#777",lineHeight:1.5}}>{tip}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LOGROS TAB ───────────────────────────────────────────────────────────────
function LogrosTab({totalXp,level,ri,checked,weights,pr,earnedAchs,routines}){
  const totalDone=Object.values(checked).filter(Boolean).length;
  const totalWL=Object.values(weights).reduce((a,arr)=>a+(arr||[]).length,0);
  const prCount=Object.keys(pr).length;
  const daysComplete=PHASES.reduce((t,p)=>t+p.training.filter((d,di)=>d.exercises.every((_,ei)=>checked[exKey(p.id,di,ei)])).length,0);
  return(
    <div>
      <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:14}}>SALA DE TROFEOS</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
        {[{icon:"⚡",l:"XP TOTAL",v:totalXp.toLocaleString()},{icon:"🔮",l:"NIVEL",v:level},{icon:"⚔️",l:"EJERCICIOS",v:totalDone},{icon:"🏰",l:"DÍAS COMPLETADOS",v:daysComplete},{icon:"🏆",l:"RÉCORDS",v:prCount},{icon:"📊",l:"PESOS REGISTRADOS",v:totalWL}].map(s=>(
          <div key={s.l} style={{background:"#0F0F1C",borderRadius:10,padding:14,border:"1px solid #1E1E32",textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:22,fontWeight:700,color:ri.color,fontFamily:"'Rajdhani',sans-serif"}}>{s.v}</div>
            <div style={{fontSize:9,color:"#444",letterSpacing:2}}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{background:"#0F0F1C",borderRadius:12,padding:16,border:`1px solid ${ri.color}44`,marginBottom:18}}>
        <div style={{fontSize:9,color:"#444",letterSpacing:3,marginBottom:12}}>RANGOS DEL SISTEMA</div>
        {RANKS.map(r=>{const isA=level>=r.minLevel&&level<=r.maxLevel;const isP=level>r.maxLevel;return(
          <div key={r.rank} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,opacity:isP?.5:isA?1:.3}}>
            <div style={{width:30,height:30,borderRadius:8,border:`2px solid ${r.color}`,display:"flex",alignItems:"center",justifyContent:"center",background:isA?`${r.color}22`:"transparent",fontSize:13,fontWeight:900,color:r.color,fontFamily:"'Cinzel',serif",boxShadow:isA?`0 0 12px ${r.glow}`:"none",flexShrink:0}}>{r.rank}</div>
            <div style={{flex:1}}><div style={{fontSize:12,color:isA?"#FFF":"#666",fontWeight:700,fontFamily:"'Rajdhani',sans-serif"}}>{r.title}</div><div style={{fontSize:10,color:"#444"}}>Lv {r.minLevel}–{r.maxLevel}</div></div>
            {isP?<span>✅</span>:isA?<span style={{fontSize:10,color:r.color,fontWeight:700,letterSpacing:1}}>ACTUAL</span>:null}
          </div>
        );})}
      </div>
      <div style={{fontSize:9,color:"#3A3A5E",letterSpacing:3,marginBottom:12}}>LOGROS</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,paddingBottom:20}}>
        {ACHIEVEMENTS.map(ach=>{const done=earnedAchs.includes(ach.id);return(
          <div key={ach.id} style={{background:done?"#0F0F20":"#0A0A14",border:`1px solid ${done?"#A78BFA66":"#1E1E2E"}`,borderRadius:12,padding:14,opacity:done?1:.5,boxShadow:done?"0 0 16px #A78BFA22":"none"}}>
            <div style={{fontSize:28,marginBottom:6}}>{ach.icon}</div>
            <div style={{fontSize:12,fontWeight:700,color:done?"#FFF":"#555",fontFamily:"'Rajdhani',sans-serif",lineHeight:1.2,marginBottom:3}}>{ach.name}</div>
            <div style={{fontSize:10,color:"#444",lineHeight:1.4,marginBottom:6}}>{ach.desc}</div>
            <div style={{fontSize:11,color:done?"#A78BFA":"#333",fontWeight:700}}>+{ach.xp} XP</div>
          </div>
        );})}
      </div>
    </div>
  );
}
