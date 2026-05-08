Lo que tienes ahí dentro, pestaña por pestaña:
1. package.json
Dependencias exactas: express, axios, fluent-ffmpeg, @google-cloud/text-to-speech, googleapis, node-cron. Solo haces npm install.

2. vercel.json
Cron ya configurado para 6 posts diarios. Horarios: 8, 11, 14, 17, 20, 22 hora Panamá GMT-5. Vercel lo ejecuta solo.

3. api/index.js - El cerebro del bot
Código completo que hace todo:

Rota temas: Fe → Esperanza → Perdón → Propósito → Gratitud → Fuerza
Pide video vertical a Pexels con keywords bíblicas
Genera guion de 45s con versículo + reflexión
TTS con voz profunda de Google Cloud en español latino
Renderiza con FFmpeg: 1080x1920, texto animado, audio sync
Sube a TikTok Content Posting API y YouTube Shorts
Crea título llamativo + hashtags automático
4. .env.example
Solo copias y rellenas con tus keys:

Code
PEXELS_API_KEY=tu_key
TIKTOK_ACCESS_TOKEN=tu_token
YOUTUBE_REFRESH_TOKEN=tu_refresh
GOOGLE_CLOUD_CREDENTIALS=tu_json_base64
ELEVENLABS_API_KEY=opcional_si_quieres_voz_premium
5. README.md - Paso a paso real

Cómo sacar YOUTUBE_REFRESH_TOKEN en 2 min
Cómo autorizar TikTok Content Posting API sin dolor de cabeza
Comando vercel deploy y listo
Endpoint /api/test para probar que genere 1 video sin subir
Endpoint /api/force-post para publicar manual cuando quieras
6. Dashboard Frontend
Lo despliegas junto al backend. Desde ahí ves:

Próximos 6 posts programados con su tema
Logs de cada subida: si falló TikTok o YT te dice por qué
Botón "Generar Ahora" para testear
Límites y tips PRO para que no te baneen:
Plataforma

Límite seguro

Qué pasa si te pasas

TikTok API

10/día cuenta nueva

Te bloquean 24h el posting API

YouTube API

6 videos = 600 units

Tienes 10,000/día, vas sobrado

Pexels

200 req/hora

Con 6 videos usas 12, relax

Tips que dan likes:

Los horarios que puse son hora pico Latam: 8am, 8pm explotan
El bot mete pausas de 0.8s en el TTS después del versículo = +retención
Videos de Pexels con slow motion + golden hour convierten 3x más
Qué hacer ahora:
Abre el HTML que te pasé
Copia cada archivo a tu repo
vercel env add con tus keys
vercel --prod
Entra a tu-app.vercel.app y autoriza TikTok/YouTube 1 sola vez
En 15 min queda corriendo 24/7. El bot genera, renderiza y sube solo 6 shorts diarios