/**
 * Diccionario de traducciones ES/EN. El fragmento entre **...** se resalta con
 * gradiente vía <Highlight/>. Acceso: const { t } = useLang(); t.hero.title …
 */

export type Lang = "es" | "en";

const es = {
  nav: {
    links: [
      { label: "Plataforma", href: "#que-es" },
      { label: "Marketplace", href: "#marketplace" },
      { label: "Tecnologías", href: "#tecnologias" },
      { label: "Nosotros", href: "#nosotros" },
    ],
    cta: "Contactar asesor",
    menu: "Menú",
  },
  hero: {
    badge: "INIA · Agricultura 4.0",
    title: "El campo\n**inteligente** de Chile",
    subtitle:
      "La plataforma de INIA que reúne investigación, extensión y tecnología para el campo: monitoreo satelital, clima, tour virtual 360° y Avisa, el asistente que te escribe por WhatsApp.",
    ctaTour: "Tour virtual 360°",
    stats: [
      { value: "10 m", label: "Monitoreo satelital" },
      { value: "Nacional", label: "Cobertura" },
      { value: "Gratuito", label: "Acceso" },
    ],
    live: "live · sentinel-2",
  },
  queEs: {
    kicker: "Qué es Smartfield",
    title: "Una plataforma que **unifica el campo** y la tecnología",
    subtitle:
      "Smartfield INIA nace para integrar las innumerables herramientas tecnológicas dispersas en el mundo agropecuario y entregar una oferta colaborativa, gratuita y accesible desde el computador o el teléfono.",
    pillars: [
      {
        title: "Investigación",
        text: "El conocimiento científico de INIA y su red de centros regionales aplicado directamente al campo.",
      },
      {
        title: "Extensión",
        text: "Extensionistas y asesores conectados con productores mediante capacitación y acompañamiento a distancia.",
      },
      {
        title: "Mercado tecnológico",
        text: "Un marketplace que reúne las herramientas AgTech dispersas en la industria en una oferta colaborativa.",
      },
    ],
  },
  marketplace: {
    kicker: "Marketplace AgTech",
    title: "Un recorrido por las **tecnologías del campo**",
    subtitle:
      "Navega un catálogo colaborativo de servicios y soluciones tecnológicas, con contacto directo a distribuidores y a los extensionistas de INIA.",
    badge: "Fotos y videos 360°",
    cta: "Iniciar recorrido",
    items: [
      {
        title: "Tour virtual 360°",
        text: "Recorre el marketplace con fotografías y videos en 360° y realidad virtual, como si estuvieras en terreno.",
        tag: "Inmersivo",
      },
      {
        title: "Riego inteligente",
        text: "Sensores en campo transmiten vía satélite el estado hídrico para un monitoreo eficiente del agua de riego.",
        tag: "Hídrico",
      },
      {
        title: "Mapas y segmentación",
        text: "Planos de segmentación y cartografía digital para planificar manejo por zonas de cada predio.",
        tag: "Cartografía",
      },
      {
        title: "Sensoramiento & Big Data",
        text: "Estaciones, sondas y sensores alimentan modelos de datos para decisiones agronómicas informadas.",
        tag: "Datos",
      },
      {
        title: "Drones & maquinaria",
        text: "Drones autónomos, autopiloto de tractores y maquinaria con aplicaciones digitales integradas.",
        tag: "Maquinaria",
      },
      {
        title: "Monitoreo satelital",
        text: "Visualiza déficit hídrico y vigor vegetal con índices satelitales actualizados periódicamente.",
        tag: "Satelital",
      },
    ],
  },
  satelital: {
    kicker: "Monitoreo satelital",
    title: "Ve el **déficit hídrico** antes de que sea tarde",
    subtitle:
      "La información de riego entregada por los sensores en campo es expedita y se emite vía satélite, permitiendo un monitoreo inteligente del agua de riego y del estado de cada cultivo.",
    caption: "NDVI · predio demo",
    low: "bajo",
    high: "alto",
    features: [
      "Visualización de déficit hídrico por sector del predio",
      "Índices de vigor vegetal (NDVI, NDRE, NDMI) actualizados",
      "Señal satelital de sensores instalados en terreno",
      "Alertas tempranas para optimizar el agua de riego",
    ],
  },
  tecnologias: {
    kicker: "Tecnologías integradas",
    title: "Todo el **stack agro 4.0** en un solo lugar",
    subtitle:
      "Soluciones que antes estaban dispersas, hoy reunidas en una oferta colaborativa para productores, asesores y empresas tecnológicas.",
    tabs: [
      { key: "todo", label: "Todo" },
      { key: "sensores", label: "Sensores" },
      { key: "satelital", label: "Satelital" },
      { key: "maquinaria", label: "Maquinaria" },
      { key: "datos", label: "Datos" },
    ],
    flipHint: "Toca para más información",
    flipBack: "Toca para volver",
    items: [
      {
        title: "Sistemas de sensoramiento",
        cat: "sensores",
        text: "Redes de sensores en terreno que capturan variables clave (humedad, temperatura, nutrientes) y las transmiten en tiempo real a la plataforma.",
      },
      {
        title: "Big data agronómico",
        cat: "datos",
        text: "Integra datos de campo, clima y satélite en modelos que apoyan decisiones de manejo basadas en evidencia.",
      },
      {
        title: "Mapas y planos de segmentación",
        cat: "satelital",
        text: "Cartografía digital que divide el predio en zonas de manejo según suelo, vigor y topografía.",
      },
      {
        title: "Monitoreo satelital",
        cat: "satelital",
        text: "Imágenes Sentinel-2 de libre acceso para seguir el vigor (NDVI) y el estado hídrico del cultivo cada pocos días.",
      },
      {
        title: "Drones autónomos",
        cat: "maquinaria",
        text: "Vuelos programados que levantan imágenes de alta resolución para detectar problemas antes de que sean visibles a pie de campo.",
      },
      {
        title: "Autopiloto de tractores",
        cat: "maquinaria",
        text: "Guiado satelital de precisión para siembra, pulverización y cosecha, con mínima superposición.",
      },
      {
        title: "Sondas de humedad de suelo",
        cat: "sensores",
        text: "Miden el agua disponible en distintas profundidades del suelo para calendarizar el riego con precisión.",
      },
      {
        title: "Estaciones meteorológicas (EMA)",
        cat: "sensores",
        text: "Registran el clima local en tiempo real y alimentan las alertas de heladas, calor y sequía.",
      },
    ],
  },
  losTilos: {
    kicker: "Centro Experimental",
    title: "Los Tilos: **un campo colaborativo** abierto a la innovación",
    subtitle:
      "Un espacio donde empresas e instituciones muestran prototipos de maquinaria y soluciones tecnológicas en condiciones reales. Visítalo de forma presencial o recórrelo en el tour virtual.",
    badge1: "Visitas presenciales",
    badge2: "Prototipos en terreno",
    cta: "Coordinar una visita",
    location: "Buin · Región Metropolitana",
    statValue: "1982",
    statLabel: "Centro de fruticultura",
  },
  capacitaciones: {
    kicker: "Capacitación & conocimiento",
    title: "Capacitación y herramientas para la **agricultura digital**",
    subtitle:
      "Accede a cursos y contenidos especializados para fortalecer tus conocimientos en tecnologías agrícolas y agricultura digital, desde cualquier lugar.",
    cards: [
      {
        title: "Campus Virtual",
        text: "Accede a cursos gratuitos y contenidos especializados para fortalecer tus conocimientos en tecnologías y agricultura digital.",
        cta: "Ir al Campus",
        href: "https://www.smartfieldinia.cl/campus/",
      },
      {
        title: "Biblioteca Agricultura 4.0",
        text: "Una introducción práctica a la agricultura 4.0 con recursos, guías y contenidos abiertos.",
        cta: "Explorar biblioteca",
        href: "https://biblioteca.inia.cl",
      },
    ],
  },
  partners: {
    kicker: "Ecosistema AgTech",
    title: "Partners del marketplace",
  },
  respaldo: {
    kicker: "Respaldo institucional",
    title: "La fuerza de **INIA** detrás de cada dato",
    subtitle:
      "El Instituto de Investigaciones Agropecuarias es la principal institución de investigación agrícola de Chile, con presencia en todo el territorio nacional.",
    stats: [
      { label: "Centros regionales de investigación" },
      { label: "Estaciones agrometeorológicas" },
      { label: "Publicaciones en la Biblioteca Digital" },
      { label: "Regiones con cobertura" },
    ],
  },
  asesor: {
    kicker: "Avisa · INIA",
    title: "Resuelve tus dudas con **información técnica validada**",
    subtitle:
      "Accede al conocimiento con un asistente virtual que utiliza exclusivamente información técnica validada y disponible en la Biblioteca INIA.",
    contact: "Consultar a Avisa",
    explore: "Explorar marketplace",
    teamCaption: "Nuestro equipo SmartField",
    channels: [
      {
        title: "Empresas distribuidoras",
        text: "Conéctate directamente con los proveedores de cada tecnología del marketplace.",
      },
      {
        title: "Asistente virtual INIA",
        text: "Resuelve dudas técnicas con información validada de la Biblioteca Digital INIA.",
      },
    ],
  },
  avisa: {
    kicker: "Avisa · INIA",
    acronym: "Asistente Virtual de Información Satelital y Agroclimática",
    homeTitle: "Tu campo te **avisa** antes de que sea tarde",
    homeSubtitle:
      "Avisa es el asistente de INIA que vigila el clima y el satélite de tu campo y te escribe por WhatsApp: heladas, calor, falta de agua y vigor de tus cultivos. Y responde tus dudas de manejo con la Biblioteca INIA.",
    bullets: [
      { title: "Avisos a tiempo", text: "Helada, calor y déficit hídrico en tu campo, con un día de anticipación." },
      { title: "Satélite cada semana", text: "Vigor (NDVI) de Sentinel-2 comparado con la temporada anterior." },
      { title: "Pregunta por WhatsApp", text: "Escribe o manda una nota de voz. Responde con publicaciones INIA." },
    ],
    ctaPrimary: "Conoce Avisa",
    ctaRegister: "Solicitar acceso",
    ctaLogin: "Iniciar sesión",
    ctaWhatsapp: "Escribir por WhatsApp",
    ctaDemo: "Probar sin cuenta",
    install: {
      cta: "Instalar Avisa en tu teléfono",
      title: "Instala Avisa en tu teléfono",
      ios: ["Toca el botón Compartir (abajo en Safari, o arriba en Chrome).", "Baja y elige “Agregar a inicio”.", "Toca “Agregar”. Avisa queda como una app en tu pantalla."],
      android: ["Toca el menú ⋮ del navegador (arriba a la derecha).", "Elige “Instalar app” o “Agregar a la pantalla de inicio”.", "Confirma. Avisa queda como una app en tu pantalla."],
      ok: "Entendido",
    },
    chatStatus: "en línea",
    chat: [
      { from: "avisa", text: "❄️ Avisa INIA: mañana se esperan −1,5 °C al amanecer en tu campo Los Robles. Protege los cerezos en flor desde las 4:00.", time: "18:02" },
      { from: "user", text: "¿Y cómo viene el vigor del campo?", time: "18:05" },
      { from: "avisa", text: "El vigor (NDVI 0,71) está 8 % sobre la misma semana del año pasado. No hay señales de estrés hídrico.", time: "18:05" },
    ],
    pageTitle: "Avisos de **clima y satélite** para tu campo, por WhatsApp",
    pageSubtitle:
      "Avisa cruza el pronóstico, las estaciones agroclimáticas y las imágenes satelitales con los campos que dibujas, y te escribe solo cuando hay algo que hacer. Gratis, de INIA.",
    stepsKicker: "Cómo funciona",
    stepsTitle: "Tres pasos y **listo**",
    steps: [
      { title: "Solicita acceso", text: "Déjanos tus datos y el equipo de INIA te envía una invitación a tu correo." },
      { title: "Dibuja tu campo", text: "Marca el contorno en el mapa satelital y elige tu cultivo." },
      { title: "Recibe los avisos", text: "Avisa te escribe cuando viene una helada, calor o falta de agua, y cada lunes un resumen." },
    ],
    sourcesKicker: "Con qué trabaja",
    sourcesTitle: "Información **validada**, no inventada",
    sources: [
      { title: "Biblioteca INIA", text: "Más de 1.400 publicaciones técnicas de INIA, citadas con su enlace." },
      { title: "Clima y agroclima", text: "Pronóstico, estaciones INIA, heladas, calor, grados-día y horas frío." },
      { title: "Satélite Sentinel-2", text: "Vigor vegetal cada 5 días a 10 m, comparado con años anteriores." },
    ],
    finalTitle: "Empieza a recibir **avisos** hoy",
    finalSubtitle: "Gratis para productores, asesores y extensionistas.",
  },
  cta: {
    kicker: "Empieza hoy · gratuito",
    title: "Lleva la **agricultura 4.0** a tu campo",
    subtitle:
      "Visualiza tu campo en tiempo real, accede a tecnología de punta y conecta con la red de innovación agrícola de INIA. Desde tu computador o tu teléfono.",
    explore: "Explorar plataforma",
    contact: "Contactar asesor",
  },
  footer: {
    tagline:
      "Smartfield INIA — agricultura 4.0 que articula investigación, extensión y mercado tecnológico para el campo de Chile.",
    cols: [
      {
        title: "Plataforma",
        links: [
          { label: "Marketplace", href: "#marketplace" },
          { label: "Monitoreo satelital", href: "#satelital" },
          { label: "Tecnologías", href: "#tecnologias" },
        ],
      },
      {
        title: "INIA",
        links: [
          { label: "inia.cl", href: "https://www.inia.cl" },
          { label: "Biblioteca Digital", href: "https://biblioteca.inia.cl" },
          { label: "Agrometeorología", href: "https://www.agrometeorologia.cl" },
          { label: "Smartfield", href: "https://www.smartfieldinia.cl" },
        ],
      },
      {
        title: "Contacto",
        links: [
          { label: "Nosotros", href: "#nosotros" },
          { label: "Centro Los Tilos", href: "#los-tilos" },
        ],
      },
    ],
    rights:
      "INIA — Instituto de Investigaciones Agropecuarias. Todos los derechos reservados.",
    by: "Desarrollado por",
  },
  tour: {
    back: "Volver",
    title: "Tour 360°",
    loading: "Cargando recorrido 360°",
    hint: "arrastra para mirar · clic en los puntos",
    scenes: {
      campo: { name: "Vista general del campo", caption: "Centro Experimental Los Tilos · Buin" },
      parronal: { name: "Parronal y cultivos", caption: "Fruticultura de precisión" },
      riego: { name: "Sector de riego", caption: "Riego inteligente · gestión hídrica" },
      estacion: { name: "Estación de monitoreo", caption: "Red agrometeorológica INIA" },
      sensores: { name: "Sensores en campo", caption: "Sensoramiento & big data" },
      maquinaria: { name: "Zona de maquinaria", caption: "Drones, autopiloto y AgTech" },
      huerto: { name: "Recorrido del huerto", caption: "Biodiversidad y polinización" },
    } as Record<string, { name: string; caption: string }>,
  },
  nosotros: {
    kicker: "Quiénes somos",
    title: "Un **ecosistema colaborativo** para la agricultura digital",
    subtitle:
      "SmartField INIA reúne a empresas AgTech, instituciones públicas, centros de investigación y actores del sector agrícola para acelerar la adopción de tecnologías digitales en la agricultura.",
    mision: "Nuestra misión",
    misionText:
      "Promover la adopción y escalamiento de tecnologías Agro 4.0 mediante un ecosistema colaborativo que conecte innovación, capacitación, validación tecnológica y transferencia de conocimiento, contribuyendo al desarrollo de una agricultura más competitiva y sostenible.",
    vision: "Nuestra visión",
    visionText:
      "Ser el principal ecosistema de innovación y agricultura digital de Chile y un referente en Latinoamérica para la validación, difusión y adopción de tecnologías que impulsen una agricultura moderna, eficiente y basada en datos.",
    proposito: "Nuestro propósito",
    propositoText:
      "Impulsar la transformación digital de la agricultura mediante la colaboración entre el sector público, privado y académico, facilitando el acceso a tecnologías, conocimiento y capacitación que permitan enfrentar los desafíos productivos, ambientales y sociales del sector agrícola.",
    colaboracion: "La importancia de la colaboración",
    colaboracionIntro:
      "La transformación digital de la agricultura no depende únicamente de la tecnología. Requiere la colaboración entre productores, empresas, instituciones públicas, centros de investigación y profesionales del sector.",
    colaboracionItems: [
      "Los desafíos agrícolas requieren nuevas tecnologías.",
      "La adopción tecnológica necesita capacitación y acompañamiento.",
      "La colaboración entre empresas, instituciones y productores acelera la innovación.",
      "SmartField conecta estos actores para generar impacto real en el territorio.",
    ],
    pilares: [
      {
        icon: "flask",
        title: "Validación tecnológica",
        text: "Probamos tecnologías en condiciones reales para generar evidencia y confianza en su uso.",
      },
      {
        icon: "graduation",
        title: "Capacitación y transferencia",
        text: "Desarrollamos cursos virtuales, actividades presenciales y recursos educativos especializados.",
      },
      {
        icon: "handshake",
        title: "Vinculación y colaboración",
        text: "Generamos redes entre empresas, instituciones y usuarios finales del sector agrícola.",
      },
      {
        icon: "trending",
        title: "Escalamiento e innovación",
        text: "Apoyamos el desarrollo y adopción de nuevas soluciones tecnológicas para el agro.",
      },
    ],
  },
  plataformas: {
    kicker: "Ecosistema SmartField",
    title: "Explora las **plataformas del ecosistema**",
    subtitle:
      "SmartField integra múltiples plataformas para que productores, asesores y empresas accedan a formación, tecnología y conocimiento en un solo lugar.",
    items: [
      {
        title: "Campus Virtual",
        text: "Accede a cursos gratuitos y contenidos especializados en tecnologías agrícolas y agricultura digital.",
        cta: "Ir al Campus",
        href: "https://www.smartfieldinia.cl/campus/",
      },
      {
        title: "Showroom 360°",
        text: "Explora vitrinas virtuales de tecnologías AgTech disponibles para productores y empresas del sector.",
        cta: "Ver Showroom",
        href: "/plataforma",
      },
    ],
  },
};

const en: typeof es = {
  nav: {
    links: [
      { label: "Platform", href: "#que-es" },
      { label: "Marketplace", href: "#marketplace" },
      { label: "Technologies", href: "#tecnologias" },
      { label: "About us", href: "#nosotros" },
    ],
    cta: "Talk to an advisor",
    menu: "Menu",
  },
  hero: {
    badge: "INIA · Agriculture 4.0",
    title: "Chile's\n**smart** field",
    subtitle:
      "INIA's platform bringing research, extension and technology to the field: satellite monitoring, weather, a 360° virtual tour and Avisa, the assistant that messages you on WhatsApp.",
    ctaTour: "360° virtual tour",
    stats: [
      { value: "10 m", label: "Satellite monitoring" },
      { value: "Nationwide", label: "Coverage" },
      { value: "Free", label: "Access" },
    ],
    live: "live · sentinel-2",
  },
  queEs: {
    kicker: "What is Smartfield",
    title: "A platform that **unifies the field** and technology",
    subtitle:
      "Smartfield INIA was created to integrate the countless technological tools scattered across agriculture into a collaborative, free offering, accessible from your computer or phone.",
    pillars: [
      {
        title: "Research",
        text: "INIA's scientific knowledge and its network of regional centers applied directly to the field.",
      },
      {
        title: "Extension",
        text: "Extension agents and advisors connected to growers through training and remote support.",
      },
      {
        title: "AgTech marketplace",
        text: "A marketplace that gathers the AgTech tools scattered across the industry into one collaborative offering.",
      },
    ],
  },
  marketplace: {
    kicker: "AgTech Marketplace",
    title: "A journey through **field technologies**",
    subtitle:
      "Browse a collaborative catalog of technological services and solutions, with direct contact to distributors and INIA extension agents.",
    badge: "360° photos & videos",
    cta: "Start the tour",
    items: [
      {
        title: "360° virtual tour",
        text: "Explore the marketplace with 360° photos and videos and virtual reality, as if you were on site.",
        tag: "Immersive",
      },
      {
        title: "Smart irrigation",
        text: "In-field sensors transmit water status via satellite for efficient irrigation monitoring.",
        tag: "Water",
      },
      {
        title: "Maps & zoning",
        text: "Segmentation plans and digital cartography to plan management by zones across each field.",
        tag: "Mapping",
      },
      {
        title: "Sensing & Big Data",
        text: "Stations, probes and sensors feed data models for informed agronomic decisions.",
        tag: "Data",
      },
      {
        title: "Drones & machinery",
        text: "Autonomous drones, tractor autopilot and machinery with integrated digital applications.",
        tag: "Machinery",
      },
      {
        title: "Satellite monitoring",
        text: "Visualize water deficit and crop vigor with regularly updated satellite indices.",
        tag: "Satellite",
      },
    ],
  },
  satelital: {
    kicker: "Satellite monitoring",
    title: "Spot **water deficit** before it's too late",
    subtitle:
      "Irrigation data from in-field sensors is delivered promptly and broadcast via satellite, enabling smart monitoring of irrigation water and the status of every crop.",
    caption: "NDVI · demo field",
    low: "low",
    high: "high",
    features: [
      "Water-deficit visualization by field sector",
      "Updated crop vigor indices (NDVI, NDRE, NDMI)",
      "Satellite signal from sensors installed in the field",
      "Early alerts to optimize irrigation water",
    ],
  },
  tecnologias: {
    kicker: "Integrated technologies",
    title: "The whole **agro 4.0 stack** in one place",
    subtitle:
      "Solutions that used to be scattered, now gathered into a collaborative offering for growers, advisors and technology companies.",
    tabs: [
      { key: "todo", label: "All" },
      { key: "sensores", label: "Sensors" },
      { key: "satelital", label: "Satellite" },
      { key: "maquinaria", label: "Machinery" },
      { key: "datos", label: "Data" },
    ],
    flipHint: "Tap for more info",
    flipBack: "Tap to go back",
    items: [
      {
        title: "Sensing systems",
        cat: "sensores",
        text: "Field sensor networks that capture key variables (moisture, temperature, nutrients) and stream them to the platform in real time.",
      },
      {
        title: "Agronomic big data",
        cat: "datos",
        text: "Combines field, weather and satellite data into models that support evidence-based management decisions.",
      },
      {
        title: "Maps & zoning plans",
        cat: "satelital",
        text: "Digital cartography that splits the farm into management zones based on soil, vigor and topography.",
      },
      {
        title: "Satellite monitoring",
        cat: "satelital",
        text: "Free-access Sentinel-2 imagery to track crop vigor (NDVI) and water status every few days.",
      },
      {
        title: "Autonomous drones",
        cat: "maquinaria",
        text: "Scheduled flights that capture high-resolution imagery to spot problems before they're visible on the ground.",
      },
      {
        title: "Tractor autopilot",
        cat: "maquinaria",
        text: "Precision satellite guidance for planting, spraying and harvest work, with minimal overlap.",
      },
      {
        title: "Soil moisture probes",
        cat: "sensores",
        text: "Measure available water at different soil depths to schedule irrigation precisely.",
      },
      {
        title: "Weather stations (EMA)",
        cat: "sensores",
        text: "Log local weather in real time and feed the frost, heat and drought alerts.",
      },
    ],
  },
  losTilos: {
    kicker: "Experimental Center",
    title: "Los Tilos: **a collaborative field** open to innovation",
    subtitle:
      "A space where companies and institutions showcase machinery prototypes and technological solutions in real conditions. Visit in person or explore it in the virtual tour.",
    badge1: "In-person visits",
    badge2: "Prototypes in the field",
    cta: "Schedule a visit",
    location: "Buin · Metropolitan Region",
    statValue: "1982",
    statLabel: "Fruit-growing center",
  },
  capacitaciones: {
    kicker: "Training & knowledge",
    title: "Training and tools for **digital agriculture**",
    subtitle:
      "Access specialised courses and content to strengthen your knowledge in agricultural technologies and digital agriculture, from anywhere.",
    cards: [
      {
        title: "Virtual Campus",
        text: "Access free courses and specialised content to strengthen your knowledge in agricultural technologies and digital agriculture.",
        cta: "Go to Campus",
        href: "https://www.smartfieldinia.cl/campus/",
      },
      {
        title: "Agriculture 4.0 Library",
        text: "A practical introduction to agriculture 4.0 with resources, guides and open content.",
        cta: "Explore library",
        href: "https://biblioteca.inia.cl",
      },
    ],
  },
  partners: {
    kicker: "AgTech ecosystem",
    title: "Marketplace partners",
  },
  respaldo: {
    kicker: "Institutional backing",
    title: "The strength of **INIA** behind every data point",
    subtitle:
      "The Agricultural Research Institute is Chile's leading agricultural research institution, with a presence across the entire country.",
    stats: [
      { label: "Regional research centers" },
      { label: "Agrometeorological stations" },
      { label: "Publications in the Digital Library" },
      { label: "Regions covered" },
    ],
  },
  asesor: {
    kicker: "Avisa · INIA",
    title: "Resolve your queries with **validated technical information**",
    subtitle:
      "Access knowledge through a virtual assistant that uses exclusively validated technical information available in the INIA Library.",
    contact: "Ask Avisa",
    explore: "Explore marketplace",
    teamCaption: "Our SmartField team",
    channels: [
      {
        title: "Distributor companies",
        text: "Connect directly with the providers of each technology in the marketplace.",
      },
      {
        title: "INIA virtual assistant",
        text: "Resolve technical queries with validated information from the INIA Digital Library.",
      },
    ],
  },
  avisa: {
    kicker: "Avisa · INIA",
    acronym: "Virtual Assistant for Satellite and Agroclimatic Information",
    homeTitle: "Your field **warns you** before it's too late",
    homeSubtitle:
      "Avisa is INIA's assistant that watches the weather and satellite data of your field and messages you on WhatsApp: frost, heat, water shortage and crop vigor. It also answers your management questions with the INIA Library.",
    bullets: [
      { title: "Timely alerts", text: "Frost, heat and water deficit on your field, one day ahead." },
      { title: "Weekly satellite", text: "Sentinel-2 vigor (NDVI) compared with last season." },
      { title: "Ask on WhatsApp", text: "Type or send a voice note. Answers with INIA publications." },
    ],
    ctaPrimary: "Meet Avisa",
    ctaRegister: "Request access",
    ctaLogin: "Sign in",
    ctaWhatsapp: "Message on WhatsApp",
    ctaDemo: "Try without an account",
    install: {
      cta: "Install Avisa on your phone",
      title: "Install Avisa on your phone",
      ios: ["Tap the Share button (bottom in Safari, top in Chrome).", "Scroll down and choose “Add to Home Screen”.", "Tap “Add”. Avisa shows up as an app on your screen."],
      android: ["Tap the browser’s ⋮ menu (top right).", "Choose “Install app” or “Add to Home screen”.", "Confirm. Avisa shows up as an app on your screen."],
      ok: "Got it",
    },
    chatStatus: "online",
    chat: [
      { from: "avisa", text: "❄️ Avisa INIA: −1.5 °C expected at dawn tomorrow on your Los Robles field. Protect the blooming cherry trees from 4:00.", time: "18:02" },
      { from: "user", text: "And how is the field's vigor?", time: "18:05" },
      { from: "avisa", text: "Vigor (NDVI 0.71) is 8% above the same week last year. No signs of water stress.", time: "18:05" },
    ],
    pageTitle: "**Weather and satellite** alerts for your field, on WhatsApp",
    pageSubtitle:
      "Avisa combines forecasts, agroclimatic stations and satellite imagery with the fields you draw, and messages you only when there is something to do. Free, from INIA.",
    stepsKicker: "How it works",
    stepsTitle: "Three steps and **done**",
    steps: [
      { title: "Request access", text: "Leave your details and the INIA team sends an invitation to your email." },
      { title: "Draw your field", text: "Outline it on the satellite map and pick your crop." },
      { title: "Get alerts", text: "Avisa messages you when frost, heat or water shortage is coming, plus a Monday summary." },
    ],
    sourcesKicker: "What it uses",
    sourcesTitle: "**Validated** information, not made up",
    sources: [
      { title: "INIA Library", text: "Over 1,400 INIA technical publications, cited with their link." },
      { title: "Weather and agroclimate", text: "Forecast, INIA stations, frost, heat, degree-days and chill hours." },
      { title: "Sentinel-2 satellite", text: "Vegetation vigor every 5 days at 10 m, compared with previous years." },
    ],
    finalTitle: "Start getting **alerts** today",
    finalSubtitle: "Free for growers, advisors and extension agents.",
  },
  cta: {
    kicker: "Start today · free",
    title: "Bring **agriculture 4.0** to your field",
    subtitle:
      "Monitor your field in real time, access cutting-edge technology and connect with INIA's agricultural innovation network. From your computer or your phone.",
    explore: "Explore the platform",
    contact: "Talk to an advisor",
  },
  footer: {
    tagline:
      "Smartfield INIA — agriculture 4.0 connecting research, extension and the AgTech market for Chile's fields.",
    cols: [
      {
        title: "Platform",
        links: [
          { label: "Marketplace", href: "#marketplace" },
          { label: "Satellite monitoring", href: "#satelital" },
          { label: "Technologies", href: "#tecnologias" },
        ],
      },
      {
        title: "INIA",
        links: [
          { label: "inia.cl", href: "https://www.inia.cl" },
          { label: "Digital Library", href: "https://biblioteca.inia.cl" },
          { label: "Agrometeorology", href: "https://www.agrometeorologia.cl" },
          { label: "Smartfield", href: "https://www.smartfieldinia.cl" },
        ],
      },
      {
        title: "Contact",
        links: [
          { label: "About us", href: "#nosotros" },
          { label: "Los Tilos Center", href: "#los-tilos" },
        ],
      },
    ],
    rights:
      "INIA — Agricultural Research Institute. All rights reserved.",
    by: "Built by",
  },
  tour: {
    back: "Back",
    title: "360° Tour",
    loading: "Loading 360° tour",
    hint: "drag to look around · click the points",
    scenes: {
      campo: { name: "Field overview", caption: "Los Tilos Experimental Center · Buin" },
      parronal: { name: "Vineyard & crops", caption: "Precision fruit growing" },
      riego: { name: "Irrigation area", caption: "Smart irrigation · water management" },
      estacion: { name: "Monitoring station", caption: "INIA agrometeorological network" },
      sensores: { name: "Field sensors", caption: "Sensing & big data" },
      maquinaria: { name: "Machinery area", caption: "Drones, autopilot and AgTech" },
      huerto: { name: "Orchard walk", caption: "Biodiversity and pollination" },
    },
  },
  nosotros: {
    kicker: "Who we are",
    title: "A **collaborative ecosystem** for digital agriculture",
    subtitle:
      "SmartField INIA brings together AgTech companies, public institutions, research centres and agricultural sector players to accelerate the adoption of digital technologies in agriculture.",
    mision: "Our mission",
    misionText:
      "To promote the adoption and scaling of Agro 4.0 technologies through a collaborative ecosystem connecting innovation, training, technological validation and knowledge transfer, contributing to the development of a more competitive and sustainable agriculture.",
    vision: "Our vision",
    visionText:
      "To be Chile's leading digital agriculture and innovation ecosystem and a Latin American reference for the validation, dissemination and adoption of technologies that drive a modern, efficient and data-driven agriculture.",
    proposito: "Our purpose",
    propositoText:
      "To drive the digital transformation of agriculture through collaboration between the public, private and academic sectors, facilitating access to technologies, knowledge and training to address the productive, environmental and social challenges of the agricultural sector.",
    colaboracion: "The importance of collaboration",
    colaboracionIntro:
      "The digital transformation of agriculture does not depend solely on technology. It requires collaboration between growers, companies, public institutions, research centres and sector professionals.",
    colaboracionItems: [
      "Agricultural challenges require new technologies.",
      "Technology adoption needs training and support.",
      "Collaboration between companies, institutions and growers accelerates innovation.",
      "SmartField connects these actors to generate real impact on the ground.",
    ],
    pilares: [
      {
        icon: "flask",
        title: "Technological validation",
        text: "We test technologies under real conditions to generate evidence and confidence in their use.",
      },
      {
        icon: "graduation",
        title: "Training & transfer",
        text: "We develop virtual courses, in-person activities and specialised educational resources.",
      },
      {
        icon: "handshake",
        title: "Networking & collaboration",
        text: "We build networks between companies, institutions and end users in the agricultural sector.",
      },
      {
        icon: "trending",
        title: "Scaling & innovation",
        text: "We support the development and adoption of new technological solutions for agriculture.",
      },
    ],
  },
  plataformas: {
    kicker: "SmartField Ecosystem",
    title: "Explore the **ecosystem platforms**",
    subtitle:
      "SmartField integrates multiple platforms so growers, advisors and companies can access training, technology and knowledge in one place.",
    items: [
      {
        title: "Virtual Campus",
        text: "Access free courses and specialised content in agricultural technologies and digital agriculture.",
        cta: "Go to Campus",
        href: "https://www.smartfieldinia.cl/campus/",
      },
      {
        title: "360° Showroom",
        text: "Explore virtual showcases of AgTech technologies available for growers and agricultural businesses.",
        cta: "View Showroom",
        href: "/plataforma",
      },
    ],
  },
};

export const translations = { es, en };
export type Dict = typeof es;
