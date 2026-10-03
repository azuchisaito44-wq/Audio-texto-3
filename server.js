// Servidor de transcripcion de audio a texto usando Groq (Whisper)
// Soporta audios largos: los corta en partes, transcribe cada una y las une.
// Pensado para desplegarse en Render.

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;

// La API key se lee de las variables de entorno de Render, nunca del codigo.
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.static('public'));

// Carpeta temporal para guardar el audio mientras se procesa
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 500 * 1024 * 1024 } // hasta 500 MB, para predicas largas
});

const DURACION_SEGMENTO = 20 * 60; // 20 minutos por segmento, en segundos

// Usa ffmpeg para saber cuanto dura el audio, en segundos
async function obtenerDuracion(rutaArchivo) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    rutaArchivo
  ]);
  return parseFloat(stdout.trim());
}

// Usa ffmpeg para cortar el audio en un segmento especifico
async function cortarSegmento(rutaArchivo, inicio, duracion, rutaSalida) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', rutaArchivo,
    '-ss', String(inicio),
    '-t', String(duracion),
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'libmp3lame',
    '-q:a', '4',
    rutaSalida
  ]);
}

async function transcribirSegmento(rutaSegmento) {
  const resultado = await groq.audio.transcriptions.create({
    file: fs.createReadStream(rutaSegmento),
    model: 'whisper-large-v3',
    language: 'es',
    response_format: 'json'
  });
  return resultado.text;
}

app.post('/transcribir', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibio ningun archivo de audio.' });
  }

  const rutaArchivo = req.file.path;
  const segmentosGenerados = [];

  try {
    const duracionTotal = await obtenerDuracion(rutaArchivo);
    const totalSegmentos = Math.ceil(duracionTotal / DURACION_SEGMENTO);

    let textoCompleto = '';

    for (let i = 0; i < totalSegmentos; i++) {
      const inicio = i * DURACION_SEGMENTO;
      const rutaSegmento = `${rutaArchivo}_parte${i}.mp3`;
      segmentosGenerados.push(rutaSegmento);

      await cortarSegmento(rutaArchivo, inicio, DURACION_SEGMENTO, rutaSegmento);
      const textoParte = await transcribirSegmento(rutaSegmento);
      textoCompleto += (textoCompleto ? ' ' : '') + textoParte.trim();
    }

    res.json({ texto: textoCompleto, partes: totalSegmentos, duracion_segundos: duracionTotal });
  } catch (err) {
    console.error('Error al transcribir:', err.message);
    res.status(500).json({ error: 'No se pudo transcribir el audio: ' + err.message });
  } finally {
    // Limpieza: borramos el archivo original y todos los segmentos temporales
    fs.unlink(rutaArchivo, () => {});
    segmentosGenerados.forEach((ruta) => fs.unlink(ruta, () => {}));
  }
});

app.get('/', (req, res) => {
  res.send('Servidor de transcripcion activo.');
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
