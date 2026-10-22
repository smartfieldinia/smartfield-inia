/**
 * Tour virtual 360° del Centro Experimental INIA Los Tilos (Buin).
 *
 * Imágenes: panoramas 360° aéreos REALES de Los Tilos, extraídos del tour oficial
 * de INIA (smartfieldinia.cl) y recompuestos como cubemaps con
 * scripts/extract-lostilos.mjs. Contenido propiedad de INIA.
 *
 * Formato cubemap (CubemapAdapter de Photo Sphere Viewer): 6 caras por escena en
 * /public/panoramas/lostilos/<slug>/{left,front,right,back,top,bottom}.jpg
 */

export type Cubemap = {
  left: string;
  front: string;
  right: string;
  back: string;
  top: string;
  bottom: string;
};

export type TourMarker = {
  id: string;
  title: string;
  text: string;
  yaw: number;
  pitch: number;
};

export type TourLink = {
  nodeId: string;
  yaw: number;
  pitch: number;
};

export type TourNode = {
  id: string;
  panorama: Cubemap;
  name: string;
  caption: string;
  markers: TourMarker[];
  links: TourLink[];
};

function faces(slug: string): Cubemap {
  const b = `/panoramas/lostilos/${slug}`;
  return {
    left: `${b}/left.jpg`,
    front: `${b}/front.jpg`,
    right: `${b}/right.jpg`,
    back: `${b}/back.jpg`,
    top: `${b}/top.jpg`,
    bottom: `${b}/bottom.jpg`,
  };
}

export const TOUR_NODES: TourNode[] = [
  {
    id: "campo",
    panorama: faces("campo"),
    name: "Vista general del campo",
    caption: "Centro Experimental Los Tilos · Buin",
    markers: [
      {
        id: "campo-bienvenida",
        title: "Bienvenido a Los Tilos",
        text: "Centro Experimental de INIA en Buin, dedicado a la investigación y demostración en fruticultura y agricultura de precisión. Arrastra para mirar y usa las flechas para recorrer el predio.",
        yaw: 0,
        pitch: -8,
      },
      {
        id: "campo-cobertura",
        title: "Monitoreo satelital",
        text: "Cada sector del predio se monitorea con índices satelitales (NDVI, NDMI) para seguir el vigor y el estado hídrico de los cultivos.",
        yaw: 110,
        pitch: -12,
      },
    ],
    links: [{ nodeId: "parronal", yaw: 60, pitch: -28 }],
  },
  {
    id: "parronal",
    panorama: faces("parronal"),
    name: "Parronal y cultivos",
    caption: "Fruticultura de precisión",
    markers: [
      {
        id: "parronal-cultivo",
        title: "Cultivos frutales",
        text: "Parronales y huertos experimentales donde INIA evalúa variedades, portainjertos y manejo agronómico.",
        yaw: -20,
        pitch: -10,
      },
    ],
    links: [
      { nodeId: "campo", yaw: -120, pitch: -28 },
      { nodeId: "riego", yaw: 75, pitch: -28 },
    ],
  },
  {
    id: "riego",
    panorama: faces("riego"),
    name: "Sector de riego",
    caption: "Riego inteligente · gestión hídrica",
    markers: [
      {
        id: "riego-caseta",
        title: "Caseta de riego",
        text: "Control y automatización del riego. Los sensores en campo transmiten su señal vía satélite para un monitoreo inteligente del agua.",
        yaw: 0,
        pitch: -8,
      },
      {
        id: "riego-goteo",
        title: "Control de goteo",
        text: "Riego por goteo de precisión que ajusta los aportes según la demanda real de cada sector.",
        yaw: 130,
        pitch: -14,
      },
    ],
    links: [
      { nodeId: "parronal", yaw: -110, pitch: -28 },
      { nodeId: "estacion", yaw: 80, pitch: -28 },
    ],
  },
  {
    id: "estacion",
    panorama: faces("estacion"),
    name: "Estación de monitoreo",
    caption: "Red agrometeorológica INIA",
    markers: [
      {
        id: "estacion-ema",
        title: "Estación meteorológica",
        text: "Sensores de temperatura, humedad, viento y radiación que alimentan las alertas agroclimáticas de la red agrometeorológica de INIA.",
        yaw: 10,
        pitch: -6,
      },
      {
        id: "estacion-suelo",
        title: "Conductividad del suelo",
        text: "Mediciones de conductividad y humedad del suelo para caracterizar la variabilidad del predio.",
        yaw: 140,
        pitch: -16,
      },
    ],
    links: [
      { nodeId: "riego", yaw: -100, pitch: -28 },
      { nodeId: "sensores", yaw: 90, pitch: -28 },
    ],
  },
  {
    id: "sensores",
    panorama: faces("sensores"),
    name: "Sensores en campo",
    caption: "Sensoramiento & big data",
    markers: [
      {
        id: "sensores-sondas",
        title: "Sondas de humedad",
        text: "Sondas a distintas profundidades que miden el contenido hídrico del suelo para decidir cuándo y cuánto regar.",
        yaw: -30,
        pitch: -10,
      },
      {
        id: "sensores-bigdata",
        title: "Big data agronómico",
        text: "Toda la captura de sensores se centraliza en modelos de datos para apoyar las decisiones agronómicas.",
        yaw: 95,
        pitch: -12,
      },
    ],
    links: [
      { nodeId: "estacion", yaw: -110, pitch: -28 },
      { nodeId: "maquinaria", yaw: 70, pitch: -28 },
    ],
  },
  {
    id: "maquinaria",
    panorama: faces("maquinaria"),
    name: "Zona de maquinaria",
    caption: "Drones, autopiloto y AgTech",
    markers: [
      {
        id: "maq-dron",
        title: "Dron autónomo",
        text: "Mapeo aéreo y aplicaciones de precisión integradas al marketplace tecnológico de Smartfield.",
        yaw: 0,
        pitch: -8,
      },
      {
        id: "maq-tractor",
        title: "Autopiloto de tractores",
        text: "Maquinaria con aplicaciones digitales que reduce costos y mejora la precisión de las labores.",
        yaw: 120,
        pitch: -14,
      },
    ],
    links: [
      { nodeId: "sensores", yaw: -110, pitch: -28 },
      { nodeId: "huerto", yaw: 80, pitch: -28 },
    ],
  },
  {
    id: "huerto",
    panorama: faces("huerto"),
    name: "Recorrido del huerto",
    caption: "Biodiversidad y polinización",
    markers: [
      {
        id: "huerto-abejas",
        title: "Polinización",
        text: "El manejo del huerto integra biodiversidad y polinizadores como parte de una producción sustentable.",
        yaw: -15,
        pitch: -8,
      },
    ],
    links: [{ nodeId: "maquinaria", yaw: -120, pitch: -28 }],
  },
];

export const FIRST_NODE_ID = TOUR_NODES[0].id;
