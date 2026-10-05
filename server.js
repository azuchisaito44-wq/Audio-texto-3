require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GROQ_API_KEY) {
  console.warn("⚠️  Falta la variable GROQ_API_KEY (ponla en Render > Environment).");
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());

// Archivos temporales en disco (límite de Groq: 25 MB)
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Muestra el index.html si está en el mismo repo
app.use(express.static(__dirname));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

async function transcribir(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No llegó ningún archivo de audio." });
  }

  // Groq necesita la extensión correcta para reconocer el formato
  const ext = path.extname(req.file.originalname) || ".mp3";
  const tempPath = req.file.path + ext;

  try {
    fs.renameSync(req.file.path, tempPath);

    const result = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-large-v3",
      language: req.body.language || "es",
      response_format: "json",
    });

    res.json({ text: result.text });
  } catch (err) {
    console.error("Error al transcribir:", err);
    res.status(500).json({ error: err.message || "Error al transcribir." });
  } finally {
    fs.unlink(tempPath, () => {});
  }
}

// El archivo se envía en el campo "audio" (también acepto "file")
const campos = upload.fields([
  { name: "audio", maxCount: 1 },
  { name: "file", maxCount: 1 },
]);

function normalizar(req, res, next) {
  campos(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const f = req.files && ((req.files.audio && req.files.audio[0]) || (req.files.file && req.files.file[0]));
    req.file = f;
    next();
  });
}

app.post(["/transcribe", "/transcribir", "/api/transcribe"], normalizar, transcribir);

app.listen(PORT, () => {
  console.log(`Servidor listo en el puerto ${PORT}`);
});
