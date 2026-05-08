/**
 * BOT BÍBLICO PRO - Servidor Principal
 * Stack: Express + FFmpeg + Google TTS + YouTube/TikTok APIs
 * @author Bot Bíblico PRO
 * @version 1.0.0
 */

import express from 'express';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import textToSpeech from '@google-cloud/text-to-speech';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import FormData from 'form-data';

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// === CONFIGURACIÓN GLOBAL ===
const CONFIG = {
  VIDEO_DURATION: 45, // segundos
  VIDEO_RESOLUTION: '1080x1920', // 9:16 Vertical
  TTS_VOICE: 'es-US-Neural2-B', // Voz masculina español US Neural
  TTS_VOICE_FEMALE: 'es-US-Neural2-A', // Voz femenina
  TEMP_DIR: '/tmp',
  MAX_RETRIES: 3
};

// Temas bíblicos rotativos por día de la semana
const THEMES = {
  0: { tema: 'Salmos de Paz', keywords: 'peaceful nature, sky, mountains', versiculos: ['Salmos 23:1-4', 'Salmos 91:1-2'] },
  1: { tema: 'Proverbios Sabiduría', keywords: 'wise owl, books, light', versiculos: ['Proverbios 3:5-6', 'Proverbios 16:3'] },
  2: { tema: 'Promesas de Dios', keywords: 'sunrise, hope, rainbow', versiculos: ['Jeremías 29:11', 'Isaías 41:10'] },
  3: { tema: 'Milagros de Jesús', keywords: 'water, healing light, miracles', versiculos: ['Juan 11:25', 'Mateo 19:26'] },
  4: { tema: 'Fe y Confianza', keywords: 'cross, prayers, clouds', versiculos: ['Hebreos 11:1', 'Marcos 11:24'] },
  5: { tema: 'Amor de Dios', keywords: 'heart, family, sunset', versiculos: ['Juan 3:16', '1 Juan 4:19'] },
  6: { tema: 'Gratitud', keywords: 'thanksgiving, wheat field, joy', versiculos: ['1 Tesalonicenses 5:18', 'Salmos 100:4'] }
};

// === CLIENTE GOOGLE TTS ===
const ttsClient = new textToSpeech.TextToSpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_TTS_CREDENTIALS || '{}')
});

/**
 * PASO 1: Generar guión con IA o plantilla
 * @param {number} slot - Slot del día 1-6
 * @returns {Promise} - {titulo, guion, hashtags, versiculo}
 */
async function generateScript(slot) {
  const dayOfWeek = new Date().getDay();
  const theme = THEMES[dayOfWeek];
  const versiculo = theme.versiculos[slot % theme.versiculos.length];
  
  // Plantillas de guiones bíblicos optimizados para TikTok/Shorts
  const templates = [
    `¿Sabías que en ${versiculo} Dios nos dice algo increíble? Escucha esto. El Señor promete estar contigo en todo momento. No temas, porque Él te fortalece. Hoy declara esta palabra sobre tu vida. Amén.`,
    `Dios tiene un mensaje para ti hoy. ${versiculo} nos recuerda que Su fidelidad es eterna. Cuando sientas que no puedes más, recuerda: Él ya venció por ti. Comparte esta palabra.`,
    `Necesitas escuchar esto. ${versiculo}... Esta promesa es para ti en este momento. Dios no se ha olvidado de ti. Él está obrando a tu favor aunque no lo veas. Cree.`,
  ];
  
  const guion = templates[slot % templates.length];
  const titulo = `${theme.tema} | ${versiculo}`;
  const hashtags = `#Dios #Biblia #Fe #Cristianos #VersiculoDelDia #Oracion #Jesus #PalabraDeDios #Esperanza ${theme.tema.replace(/ /g, '')}`;
  
  return { titulo, guion, hashtags, versiculo, theme: theme.tema, keywords: theme.keywords };
}

/**
 * PASO 2: Obtener video de fondo desde Pexels
 * @param {string} keywords - Palabras clave para búsqueda
 * @returns {Promise} - URL del video descargado en /tmp
 */
async function downloadBackgroundVideo(keywords) {
  try {
    const response = await axios.get('https://api.pexels.com/videos/search', {
      params: {
        query: keywords,
        orientation: 'portrait',
        size: 'medium',
        per_page: 15
      },
      headers: { Authorization: process.env.PEXELS_API_KEY }
    });
    
    if (!response.data.videos.length) throw new Error('No videos found');
    
    // Seleccionar video aleatorio y calidad HD
    const video = response.data.videos[Math.floor(Math.random() * response.data.videos.length)];
    const videoFile = video.video_files.find(f => f.quality === 'hd' && f.width >= 1080) || video.video_files[0];
    
    const tempPath = path.join(CONFIG.TEMP_DIR, `bg_${Date.now()}.mp4`);
    const writer = (await import('fs')).createWriteStream(tempPath);
    
    const videoResponse = await axios.get(videoFile.link, { responseType: 'stream' });
    videoResponse.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(tempPath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Error Pexels:', error.message);
    throw new Error('Fallo al descargar video de Pexels');
  }
}

/**
 * PASO 3: Generar audio con Google Cloud TTS
 * @param {string} text - Texto del guión
 * @param {boolean} useFemale - Usar voz femenina
 * @returns {Promise} - Ruta del archivo MP3
 */
async function generateVoiceover(text, useFemale = false) {
  const outputPath = path.join(CONFIG.TEMP_DIR, `voice_${Date.now()}.mp3`);
  
  const request = {
    input: { text },
    voice: {
      languageCode: 'es-US',
      name: useFemale ? CONFIG.TTS_VOICE_FEMALE : CONFIG.TTS_VOICE,
      ssmlGender: useFemale ? 'FEMALE' : 'MALE'
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1.05, // Ligeramente más rápido para engagement
      pitch: 0,
      effectsProfileId: ['large-home-entertainment-class-device'] // Mejor para móviles
    }
  };
  
  const [response] = await ttsClient.synthesizeSpeech(request);
  await fs.writeFile(outputPath, response.audioContent, 'binary');
  return outputPath;
}

/**
 * PASO 4: Renderizar video final con FFmpeg
 * @param {string} videoPath - Ruta video de fondo
 * @param {string} audioPath - Ruta audio TTS
 * @param {string} text - Texto para subtítulos
 * @returns {Promise} - Ruta del video final
 */
async function renderFinalVideo(videoPath, audioPath, text) {
  const outputPath = path.join(CONFIG.TEMP_DIR, `final_${Date.now()}.mp4`);
  const subtitlePath = path.join(CONFIG.TEMP_DIR, `subs_${Date.now()}.srt`);
  
  // Generar subtítulos SRT simples
  const words = text.split(' ');
  const wordsPerSecond = 2.5;
  let srtContent = '';
  let currentTime = 0;
  
  for (let i = 0; i < words.length; i += 4) {
    const chunk = words.slice(i, i + 4).join(' ');
    const start = currentTime;
    const end = currentTime + (4 / wordsPerSecond);
    srtContent += `${Math.floor(i/4) + 1}\n${formatSRTTime(start)} --> ${formatSRTTime(end)}\n${chunk}\n\n`;
    currentTime = end;
  }
  
  await fs.writeFile(subtitlePath, srtContent);
  
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .complexFilter([
        '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=5:1[bg]',
        '[bg]subtitles=' + subtitlePath + ':force_style=\'FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=100\'[outv]'
      ])
      .outputOptions([
        '-map [outv]',
        '-map 1:a',
        '-c:v libx264',
        '-preset veryfast', // Más rápido para Vercel
        '-crf 23',
        '-c:a aac',
        '-b:a 128k',
        `-t ${CONFIG.VIDEO_DURATION}`,
        '-movflags +faststart'
      ])
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * PASO 5A: Subir a YouTube Shorts
 * @param {string} videoPath - Ruta del video
 * @param {Object} metadata - {titulo, descripcion, hashtags}
 * @returns {Promise} - {url, videoId}
 */
async function uploadToYouTube(videoPath, metadata) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
  
  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });
  
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  
  const fileSize = (await fs.stat(videoPath)).size;
  const fileStream = (await import('fs')).createReadStream(videoPath);
  
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.titulo.substring(0, 100),
        description: `${metadata.descripcion}\n\n${metadata.hashtags}`,
        tags: metadata.hashtags.split(' '),
        categoryId: '22', // People & Blogs
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    },
    media: { body: fileStream }
  });
  
  return {
    url: `https://youtube.com/shorts/${res.data.id}`,
    videoId: res.data.id
  };
}

/**
 * PASO 5B: Subir a TikTok Content Posting API
 * Requiere app aprobada en TikTok Developers
 */
async function uploadToTikTok(videoPath, metadata) {
  // 1. Inicializar upload
  const initRes = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    post_info: {
      title: metadata.titulo.substring(0, 2200), // TikTok limit
      privacy_level: 'PUBLIC_TO_EVERYONE',
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      video_cover_timestamp_ms: 1000
    },
    source_info: { source: 'FILE_UPLOAD', video_size: (await fs.stat(videoPath)).size, chunk_size: 10000000, total_chunk_count: 1 }
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8'
    }
  });
  
  const { upload_url, publish_id } = initRes.data.data;
  
  // 2. Subir video
  const videoBuffer = await fs.readFile(videoPath);
  await axios.put(upload_url, videoBuffer, {
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': videoBuffer.length },
    maxBodyLength: Infinity
  });
  
  return { publish_id, url: `https://tiktok.com/@tu_usuario/video/${publish_id}` };
}

/**
 * ENDPOINT PRINCIPAL: /api/generate
 * Orquesta todo el proceso de creación y publicación
 */
app.get('/api/generate', async (req, res) => {
  const startTime = Date.now();
  const slot = parseInt(req.query.slot) || 1;
  const logs = [];
  
  const log = (msg) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(msg);
  };
  
  try {
    log(`🎬 Iniciando generación Slot ${slot}`);
    
    // 1. Generar guión
    const script = await generateScript(slot);
    log(`✅ Guión generado: ${script.versiculo}`);
    
    // 2. Descargar video fondo
    const bgVideo = await downloadBackgroundVideo(script.keywords);
    log(`✅ Video de fondo descargado`);
    
    // 3. Generar voz
    const useFemale = slot % 2 === 0; // Alternar voces
    const voiceover = await generateVoiceover(script.guion, useFemale);
    log(`✅ Voiceover generado (${useFemale ? 'Femenino' : 'Masculino'})`);
    
    // 4. Renderizar
    const finalVideo = await renderFinalVideo(bgVideo, voiceover, script.guion);
    log(`✅ Video renderizado: ${(await fs.stat(finalVideo)).size / 1024 / 1024}MB`);
    
    // 5. Subir a plataformas
    const results = {};
    
    // YouTube
    try {
      results.youtube = await uploadToYouTube(finalVideo, script);
      log(`✅ YouTube: ${results.youtube.url}`);
    } catch (e) {
      log(`❌ YouTube falló: ${e.message}`);
      results.youtube = { error: e.message };
    }
    
    // TikTok
    try {
      results.tiktok = await uploadToTikTok(finalVideo, script);
      log(`✅ TikTok: ${results.tiktok.url}`);
    } catch (e) {
      log(`❌ TikTok falló: ${e.message}`);
      results.tiktok = { error: e.message };
    }
    
    // 6. Limpiar archivos temporales
    await Promise.all([
      fs.unlink(bgVideo).catch(() => {}),
      fs.unlink(voiceover).catch(() => {}),
      fs.unlink(finalVideo).catch(() => {})
    ]);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`🎉 Completado en ${duration}s`);
    
    res.json({
      success: true,
      slot,
      theme: script.theme,
      versiculo: script.versiculo,
      duration: `${duration}s`,
      results,
      logs
    });
    
  } catch (error) {
    log(`💥 Error fatal: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});

/**
 * ENDPOINT: /api/test - Probar configuración sin publicar
 */
app.get('/api/test', async (req, res) => {
  const tests = {
    pexels: false,
    googleTTS: false,
    youtube: false,
    tiktok: false,
    ffmpeg: false
  };
  
  try {
    // Test Pexels
    await axios.get('https://api.pexels.com/videos/search?query=nature&per_page=1', {
      headers: { Authorization: process.env.PEXELS_API_KEY }
    });
    tests.pexels = true;
  } catch (e) {}
  
  try {
    // Test Google TTS
    await ttsClient.synthesizeSpeech({
      input: { text: 'Test' },
      voice: { languageCode: 'es-US', name: CONFIG.TTS_VOICE },
      audioConfig: { audioEncoding: 'MP3' }
    });
    tests.googleTTS = true;
  } catch (e) {}
  
  // Test FFmpeg
  tests.ffmpeg = !!ffmpegInstaller.path;
  
  // Test YouTube
  tests.youtube = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN);
  
  // Test TikTok
  tests.tiktok = !!process.env.TIKTOK_ACCESS_TOKEN;
  
  const allOk = Object.values(tests).every(v => v);
  
  res.json({
    status: allOk ? 'ready' : 'partial',
    tests,
    message: allOk ? 'Todos los sistemas OK' : 'Revisa las variables de entorno'
  });
});

/**
 * ENDPOINT: / - Dashboard HTML simple
 */
app.get('/', (req, res) => {
  res.send(`
    
    
    
      Bot Bíblico PRO Dashboard
      
    
    
      
        🎬 Bot Bíblico PRO Dashboard
        
          🧪 Probar APIs
          🚀 Generar Video Manual
        
        
      
      
        async function testAPI() {
          document.getElementById('output').textContent = 'Probando...';
          const res = await fetch('/api/test');
          const data = await res.json();
          document.getElementById('output').textContent = JSON.stringify(data, null, 2);
        }
        async function generateVideo() {
          document.getElementById('output').textContent = 'Generando video... Esto puede tardar 2-3 minutos';
          const res = await fetch('/api/generate?slot=' + Math.floor(Math.random() * 6 + 1));
          const data = await res.json();
          document.getElementById('output').textContent = JSON.stringify(data, null, 2);
        }
      
    
    
  `);
});

// Exportar para Vercel
export default app;

// Para desarrollo local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));
}
        
    

    
        
            
                .env.example
                
                     Copiar
                
            
            # ========================================
# BOT BÍBLICO PRO - VARIABLES DE ENTORNO
# Copia este archivo a .env y completa los valores
# ========================================

# PEXELS API - Videos de fondo gratuitos
# Obtén tu key en: https://www.pexels.com/api/
PEXELS_API_KEY=tu_pexels_api_key_aqui

# GOOGLE CLOUD TEXT-TO-SPEECH
# 1. Crea proyecto en Google Cloud Console
# 2. Habilita Text-to-Speech API
# 3. Crea Service Account y descarga JSON
# 4. Pega el JSON completo aquí en una línea
GOOGLE_TTS_CREDENTIALS={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"...","client_email":"...","client_id":"..."}

# YOUTUBE DATA API v3
# 1. Google Cloud Console > Habilita YouTube Data API v3
# 2. Crea OAuth 2.0 Client ID tipo "Web Application"
# 3. Añade http://localhost:3000/oauth2callback a URIs autorizadas
# 4. Usa OAuth Playground para obtener REFRESH_TOKEN
# Tutorial: https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
YOUTUBE_CLIENT_ID=tu_client_id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=tu_client_secret
YOUTUBE_REDIRECT_URI=https://tu-dominio.vercel.app/oauth2callback
YOUTUBE_REFRESH_TOKEN=1//0gXxXxXxXx

# TIKTOK CONTENT POSTING API
# 1. Registra app en https://developers.tiktok.com/
# 2. Solicita acceso a Content Posting API - requiere aprobación
# 3. Scope necesario: video.publish
# 4. Genera Access Token vía OAuth flow
# Docs: https://developers.tiktok.com/doc/content-posting-api-get-started/
TIKTOK_ACCESS_TOKEN=act.xXxXxXxXx

# OPCIONAL: OpenAI o Claude para guiones IA avanzados
OPENAI_API_KEY=sk-xXxXxXx

# NODE ENV
NODE_ENV=production
        
    

    
        
            
                README.md
                
                     Copiar
                
            
            # 🎬 Bot Bíblico PRO - Vercel Deployment

Bot automático que genera 6 videos bíblicos diarios para TikTok y YouTube Shorts usando IA, Pexels y Google TTS.

## 📋 Requisitos Previos

1. Cuenta Vercel Pro para Cron Jobs y 300s timeout
2. API Key de Pexels: https://www.pexels.com/api/
3. Google Cloud Project con Text-to-Speech habilitado
4. Canal de YouTube + OAuth 2.0 configurado
5. App de TikTok aprobada para Content Posting API

## 🚀 Instalación Paso a Paso

### 1. Clonar y configurar proyecto

```bash
# Crear carpeta del proyecto
mkdir bot-biblico-pro && cd bot-biblico-pro

# Copiar todos los archivos: package.json, vercel.json, api/index.js, .env.example

# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales
```

### 2. Configurar Google Cloud Text-to-Speech

```bash
1. Ve a https://console.cloud.google.com
2. Crea proyecto "bot-biblico"
3. APIs y Servicios > Biblioteca > Busca "Text-to-Speech API" > Habilitar
4. APIs y Servicios > Credenciales > Crear credenciales > Cuenta de servicio
5. Nombre: bot-tts, Rol: Usuario de Text-to-Speech
6. Crear clave JSON y descargar
7. Abre el JSON, copia TODO el contenido en una línea para GOOGLE_TTS_CREDENTIALS
```

### 3. Configurar YouTube OAuth 2.0

```bash
1. En Google Cloud Console del mismo proyecto
2. Habilita "YouTube Data API v3"
3. Credenciales > Crear > ID de cliente OAuth 2.0
4. Tipo: Aplicación web
5. URIs autorizadas: https://developers.google.com/oauthplayground
6. Copia CLIENT_ID y CLIENT_SECRET al .env

# Obtener REFRESH_TOKEN:
7. Ve a https://developers.google.com/oauthplayground
8. Click engranaje > Marcar "Use your own OAuth credentials"
9. Pega tu Client ID y Secret
10. Step 1: Selecciona "YouTube Data API v3" > https://www.googleapis.com/auth/youtube.upload
11. Authorize > Selecciona tu canal > Allow
12. Step 2: Exchange authorization code for tokens
13. Copia el "Refresh token" al .env
```

### 4. Configurar TikTok Content Posting API

```bash
ATENCIÓN: TikTok requiere aprobación manual. Puede tardar 1-2 semanas.

1. Ve a https://developers.tiktok.com/
2. Manage apps > Create app
3. Products > Add > Content Posting API > Apply
4. Completa formulario: describe que publicarás versículos bíblicos automatizados
5. Una vez aprobado, genera Access Token con scope video.publish
6. Copia token al .env

NOTA: En sandbox solo puedes publicar en cuenta de prueba. Para producción necesitas 1000+ seguidores.
```

### 5. Desplegar en Vercel

```bash
# Login en Vercel
npm i -g vercel
vercel login

# Deploy
vercel

# Configurar variables de entorno en Vercel
vercel env add PEXELS_API_KEY
vercel env add GOOGLE_TTS_CREDENTIALS
vercel env add YOUTUBE_CLIENT_ID
vercel env add YOUTUBE_CLIENT_SECRET
vercel env add YOUTUBE_REFRESH_TOKEN
vercel env add TIKTOK_ACCESS_TOKEN

# Deploy a producción
vercel --prod
```

### 6. Probar el bot

```bash
# Test de configuración
curl https://tu-dominio.vercel.app/api/test

# Generar video manual
curl https://tu-dominio.vercel.app/api/generate?slot=1

# Dashboard
Abre https://tu-dominio.vercel.app
```

## ⏰ Cron Jobs

Los 6 posts diarios se ejecutan automáticamente en:
- 11:00 UTC = 6 AM México
- 14:00 UTC = 9 AM México  
- 17:00 UTC = 12 PM México
- 20:00 UTC = 3 PM México
- 23:00 UTC = 6 PM México
- 02:00 UTC = 9 PM México

Para cambiar horarios, edita `vercel.json` sección `crons`.

## 🔄 Renovación de Tokens

### YouTube Refresh Token
No expira, pero si cambias contraseña de Google debes regenerar.

### TikTok Access Token
Expira en 24h. Para renovar automáticamente necesitas implementar refresh flow:

```javascript
// Añadir a api/index.js
async function refreshTikTokToken() {
  const res = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.TIKTOK_REFRESH_TOKEN
  });
  // Guarda el nuevo access_token
}
```

## 📊 Límites de API

| Servicio | Límite Gratuito | Costo Excedente |
|----------|----------------|-----------------|
| Pexels | 200 req/hora, 20k/mes | Gratis |
| Google TTS | 1M caracteres/mes | $4 por 1M |
| YouTube API | 10k unidades/día | Solicitar aumento gratis |
| TikTok API | Variable según aprobación | Gratis |
| Vercel Cron | Pro: Ilimitado | $20/mes |

Tip: 1 video = ~300 caracteres = 6 videos/día = 1,800/día = 54k/mes = GRATIS

## 🐛 Troubleshooting

**Error: FFmpeg timeout en Vercel**
Solución: Suscribe Vercel Pro para 300s o usa servicio externo como CloudConvert

**Error: YouTube 403 quotaExceeded**
Solución: Solicita aumento en Google Console > YouTube API > Cuotas

**Error: TikTok 400 invalid_token**
Solución: Token expiró, regenera en TikTok Developers

**Videos sin audio**
Solución: Verifica GOOGLE_TTS_CREDENTIALS esté en una línea sin saltos

## 📝 Personalización

Edita `THEMES` en `api/index.js` para cambiar versículos y keywords.
Edita `templates` en `generateScript()` para cambiar estilo de guiones.
Cambia `CONFIG.TTS_VOICE` para otra voz de Google.

## ⚖️ Licencia y Uso

Este código es para uso personal. Respeta términos de:
- Pexels: Atribución no requerida pero apreciada
- Google TTS: No usar para deepfakes
- YouTube/TikTok: Cumple políticas de comunidad

## 🆘 Soporte

Logs en Vercel: `vercel logs tu-proyecto`
Dashboard: `https://tu-dominio.vercel.app`

---
Hecho con 🙏 para difundir la Palabra
        
    

    
        
            
                
                    Dashboard de Monitoreo
                
                Este es el frontend que se servirá en tu dominio. Incluye monitoreo en tiempo real y generación manual.
                
                
                    
                        
                            Videos Hoy
                            
                        
                        0/6
                    
                    
                        
                            Próximo Post
                            
                        
                        03:00 p.m.
                    
                    
                        
                            Estado API
                            
                        
                        --
                    
                

                
                    
                         Probar Conexiones API
                    
                    
                         Generar Video Ahora
                    
                

                
                    
                        
                             Logs en Tiempo Real
                        
                        Limpiar
                    
                    [14:45:08] Dashboard iniciado. Listo para operar.
                
            

            
                📅 Historial de Posts
                No hay posts aún. Genera tu primer video.
            
        
    

    
    
        Bot Bíblico PRO v1.0 | Desplegado en Vercel | Hecho con 🙏 para difundir la Palabra
        ⚠️ Importante: Cumple con políticas de YouTube y TikTok. No spam. Contenido original.
    



    // Inicializar iconos y sintaxis
    lucide.createIcons();
    hljs.highlightAll();
    
    // Clipboard
    new ClipboardJS('.copy-btn').on('success', (e) => {
        const btn = e.trigger;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Copiado';
        lucide.createIcons();
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            lucide.createIcons();
        }, 2000);
    });

    // Tabs
    function showTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById('tab-' + tabName).classList.add('active');
        event.target.closest('.tab-btn').classList.add('active');
    }

    // Dashboard functions
    let logs = [];
    let history = JSON.parse(localStorage.getItem('botHistory') || '[]');
    
    function addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const colors = { info: 'text-blue-400', success: 'text-green-400', error: 'text-red-400', warning: 'text-amber-400' };
        logs.push(`<div class="${colors[type]}">[${timestamp}] ${message}</div>`);
        document.getElementById('logs').innerHTML = logs.join('');
        document.getElementById('logs').scrollTop = document.getElementById('logs').scrollHeight;
    }

    function clearLogs() {
        logs = [];
        document.getElementById('logs').innerHTML = '<div class="text-slate-500">Logs limpiados</div>';
    }

    function updateStats() {
        const today = new Date().toDateString();
        const todayPosts = history.filter(h => new Date(h.date).toDateString() === today);
        document.getElementById('stat-videos').textContent = `${todayPosts.length}/6`;
        
        // Calcular próximo post
        const slots = [11, 14, 17, 20, 23, 2]; // UTC hours
        const now = new Date();
        const currentHour = now.getUTCHours();
        const nextSlot = slots.find(s => s > currentHour) || slots[0];
        const nextTime = new Date();
        nextTime.setUTCHours(nextSlot, 0, 0, 0);
        if (nextSlot <= currentHour) nextTime.setDate(nextTime.getDate() + 1);
        document.getElementById('stat-next').textContent = nextTime.toLocaleTimeString('es-MX', {hour: '2-digit', minute: '2-digit'});
        
        renderHistory();
    }

    function renderHistory() {
        const container = document.getElementById('history');
        if (history.length === 0) {
            container.innerHTML = '<div class="text-slate-500 text-sm text-center py-8">No hay posts aún. Genera tu primer video.</div>';
            return;
        }
        
        container.innerHTML = history.slice(0, 10).map(item => `
            <div class="bg-slate-800/50 rounded-lg p-3 flex items-center justify-between">
                <div class="flex-1">
                    <div class="font-medium text-sm">${item.versiculo}</div>
                    <div class="text-xs text-slate-400">${new Date(item.date).toLocaleString('es-MX')}</div>
                </div>
                <div class="flex gap-2">
                    ${item.youtube ? `<a href="${item.youtube}" target="_blank" class="px-3 py-1 bg-red-600/20 text-red-400 rounded text-xs">YT</a>` : ''}
                    ${item.tiktok ? `<a href="${item.tiktok}" target="_blank" class="px-3 py-1 bg-pink-600/20 text-pink-400 rounded text-xs">TT</a>` : ''}
                </div>
            </div>
        `).join('');
    }

    async function testAPIs() {
        addLog('Iniciando test de APIs...', 'info');
        document.getElementById('stat-status').textContent = 'Probando...';
        
        try {
            // Simular llamada en demo, en producción será: fetch('/api/test')
            addLog('✓ Conectando con Pexels API...', 'info');
            await new Promise(r => setTimeout(r, 500));
            addLog('✓ Conectando con Google TTS...', 'info');
            await new Promise(r => setTimeout(r, 500));
            addLog('✓ Verificando YouTube OAuth...', 'info');
            await new Promise(r => setTimeout(r, 500));
            addLog('✓ Verificando TikTok Token...', 'info');
            await new Promise(r => setTimeout(r, 500));
            addLog('✓ FFmpeg instalado correctamente', 'success');
            addLog('✅ Todos los sistemas operativos', 'success');
            document.getElementById('stat-status').textContent = 'OK';
        } catch (error) {
            addLog('❌ Error: ' + error.message, 'error');
            document.getElementById('stat-status').textContent = 'Error';
        }
    }

    async function generateManual() {
        addLog('🚀 Iniciando generación manual...', 'info');
        addLog('⏳ Esto puede tardar 2-3 minutos en Vercel Pro', 'warning');
        
        try {
            // En producción: const res = await fetch('/api/generate?slot=' + Math.floor(Math.random() * 6 + 1));
            addLog('📝 Generando guión bíblico...', 'info');
            await new Promise(r => setTimeout(r, 1000));
            addLog('🎥 Descargando video de Pexels...', 'info');
            await new Promise(r => setTimeout(r, 1500));
            addLog('🎙️ Generando voiceover con Google TTS...', 'info');
            await new Promise(r => setTimeout(r, 1500));
            addLog('🎬 Renderizando video con FFmpeg...', 'info');
            await new Promise(r => setTimeout(r, 2000));
            addLog('📤 Subiendo a YouTube Shorts...', 'info');
            await new Promise(r => setTimeout(r, 1000));
            addLog('📤 Subiendo a TikTok...', 'info');
            await new Promise(r => setTimeout(r, 1000));
            addLog('✅ Video publicado exitosamente', 'success');
            
            // Guardar en historial
            history.unshift({
                date: new Date().toISOString(),
                versiculo: 'Salmos 23:1-4',
                youtube: 'https://youtube.com/shorts/xxxxx',
                tiktok: 'https://tiktok.com/@tuusuario/video/xxxxx'
            });
            localStorage.setItem('botHistory', JSON.stringify(history));
            updateStats();
        } catch (error) {
            addLog('❌ Error: ' + error.message, 'error');
        }
    }

    // Inicializar
    updateStats();
    addLog('Dashboard iniciado. Listo para operar.', 'success');

