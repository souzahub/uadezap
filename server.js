// server.js - API WhatsApp tipo Evolution (ESM Safe + Easypanel Ready)

const express = require('express');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg'); // Adicionado para transcodificação de áudio
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use('/auth', express.static('auth_info_baileys'));

let sock = null;
let qrCodeData = null;
let processedMessageIds = new Set();

// Contador para limpar o console
let logCount = 0;
const LOG_LIMIT = 10;

function customLog(...args) {
    console.log(...args);
    logCount++;
    if (logCount >= LOG_LIMIT) {
        console.clear();
        logCount = 0;
        console.log('--- Console limpo (a cada 10 logs) ---');
    }
}

// === Variáveis do Baileys (preenchidas via import dinâmico) ===
let makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser;

// === Carregar Baileys com import() dinâmico (ES Module) ===
(async () => {
    try {
        const baileys = await import('@whiskeysockets/baileys');
        makeWASocket = baileys.makeWASocket;
        useMultiFileAuthState = baileys.useMultiFileAuthState;
        DisconnectReason = baileys.DisconnectReason;
        jidNormalizedUser = baileys.jidNormalizedUser;
        customLog('✅ Baileys carregado com sucesso');
        
        // === INICIAR SERVIDOR ===
        const PORT = parseInt(process.env.PORT) || 8080;
        app.listen(PORT, () => {
            customLog(`✅ Servidor rodando na porta ${PORT}`);
            customLog(`🔗 Acesse: http://<seu-ip>:${PORT}/connect`);
            // Inicia a conexão do WhatsApp automaticamente após o carregamento do Baileys
            connectToWhatsApp().catch(err => console.error('❌ Erro ao iniciar conexão do WhatsApp:', err));
        });

    } catch (err) {
        console.error('❌ Falha ao carregar @whiskeysockets/baileys:', err.message);
        console.error('💡 Certifique-se de que o pacote está instalado: npm install @whiskeysockets/baileys');
    }
})();
// ==========================================================

// === CONFIGURAÇÕES ===
const API_KEY = process.env.API_KEY || 'minha123senha';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || null;
const VERSION = '1.0.7';

async function connectToWhatsApp() {
    customLog('🔄 Tentando conectar ao WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        browser: ['Uadezap API', 'Chrome', '1.0.2']
    });

    sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
        if (qr) {
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) qrCodeData = url;
            });
        }

        if (connection === 'open') {
            customLog('✅ WhatsApp conectado!');
            qrCodeData = null;
        }

        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                customLog('🔁 Reconectando...');
                setTimeout(() => {
                    sock = null;
                    qrCodeData = null;
                    connectToWhatsApp(); // Chama a função para reconectar
                }, 3000);
            } else {
                customLog('❌ Conexão encerrada. Faça login novamente.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Processar apenas notificações de novas mensagens
        const msg = messages[0];
        if (!msg.key || msg.key.fromMe) return;

        // Deduplicar por ID da mensagem (evita envios duplos ao webhook)
        const messageId = msg.key.id;
        if (messageId && processedMessageIds.has(messageId)) return;
        if (messageId) {
            processedMessageIds.add(messageId);
            if (processedMessageIds.size > 2000) processedMessageIds.clear();
        }

        const from = jidNormalizedUser(msg.key.remoteJid);
        const pushName = msg.pushName || 'Desconhecido';
        const textContent = msg.message?.conversation ||
                            msg.message?.extendedTextMessage?.text ||
                            msg.message?.imageMessage?.caption ||
                            msg.message?.documentMessage?.caption ||
                            msg.message?.ephemeralMessage?.message?.conversation || // Adicionado para WhatsApp Desktop
                            msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text || // Adicionado para WhatsApp Desktop
                            '[Mídia ou tipo não suportado]';
        const timestamp = msg.messageTimestamp;

        const messageData = {
            from,
            pushName,
            text: textContent.trim(),
            timestamp,
            type: 'incoming'
        };

        // Ignorar mensagens sem texto suportado (evita segundo evento com placeholder)
        if (!messageData.text || messageData.text === '[Mídia ou tipo não suportado]') return;

        customLog('📩 Recebido:', messageData);

        // Envia para webhook
                if (N8N_WEBHOOK_URL) {
                    try {
                        const payloadForN8N = {
                            event: 'messages.upsert', // Ou outro evento relevante
                            instance: messageData.instanceName || 'unknown', // Usar o nome da instância como 'instance'
                            data: {
                                key: {
                                    remoteJid: from,
                                    fromMe: false,
                                    id: messageId,
                                    // senderLid: messageData.senderLid // Se você tiver isso no messageData
                                },
                                pushName: pushName,
                                // status: "DELIVERY_ACK", // Isso pode ser mais complexo de replicar
                                message: {
                                    // Adicionar os campos específicos da mídia se for o caso
                                    // Por exemplo, para imagem:
                                    // imageMessage: { ... },
                                    // videoMessage: { ... },
                                    // ...
                                    // E o base64 no mesmo nível
                                    base64: messageData.base64,
                                    // Adicionar o tipo da mensagem aqui também
                                    messageType: messageData.type + 'Message', // ex: 'imageMessage'
                                    messageTimestamp: timestamp,
                                    // Outros campos da mensagem original do Baileys
                                    ...msg.message // Incluir o objeto 'message' original do Baileys
                                },
                                messageType: messageData.type + 'Message', // Ex: 'imageMessage'
                                messageTimestamp: timestamp,
                                instanceId: messageData.instance || 'unknown', // Usar o ID da instância
                                source: messageData.deviceType || 'unknown' // Tipo de dispositivo
                            },
                            destination: N8N_WEBHOOK_URL, // O próprio URL do webhook do N8N
                            date_time: new Date().toISOString(),
                            sender: from,
                            server_url: process.env.SERVER_URL || 'http://localhost:3000', // URL do seu servidor
                            apikey: API_KEY
                        };

                        // Se a mensagem for de mídia, garantir que os dados específicos estejam aninhados
                        if (messageData.type === 'image' && msg.message?.imageMessage) {
                            payloadForN8N.data.message.imageMessage = msg.message.imageMessage;
                        } else if (messageData.type === 'video' && msg.message?.videoMessage) {
                            payloadForN8N.data.message.videoMessage = msg.message.videoMessage;
                        } else if (messageData.type === 'audio' && msg.message?.audioMessage) {
                            payloadForN8N.data.message.audioMessage = msg.message.audioMessage;
                        } else if (messageData.type === 'document' && msg.message?.documentMessage) {
                            payloadForN8N.data.message.documentMessage = msg.message.documentMessage;
                        } else if (messageData.type === 'sticker' && msg.message?.stickerMessage) {
                            payloadForN8N.data.message.stickerMessage = msg.message.stickerMessage;
                        }


                        await axios.post(N8N_WEBHOOK_URL, payloadForN8N, {
                            timeout: 5000,
                            headers: { 'Content-Type': 'application/json' }
                        });
                        customLog(`✅ Enviado para webhook: ${from}`);
                    } catch (err) {
                        console.error('❌ Falha no webhook:', err.message);
                    }
                }
    });
}

// === MIDDLEWARE DE AUTENTICAÇÃO ===
const auth = (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (!makeWASocket) return res.status(500).json({ error: 'API ainda carregando...' });
    if (!key || key !== API_KEY) {
        return res.status(401).json({ error: 'Acesso negado. Chave API inválida.' });
    }
    next();
};

// === ROTAS ===

// Página inicial
app.get('/', (req, res) => {
    res.send(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Uadezap API v${VERSION}</title>
            <style>
                :root {
                    --bg: #0b1220;
                    --card: #111a2b;
                    --text: #e6edf3;
                    --muted: #9fb0c3;
                    --primary: #4f46e5;
                    --primary-600: #4338ca;
                    --border: #22304a;
                    --ok: #22c55e;
                    --warn: #f59e0b;
                }
                html[data-theme="light"] {
                    --bg: #f6f7fb;
                    --card: #ffffff;
                    --text: #0b1220;
                    --muted: #536174;
                    --primary: #4f46e5;
                    --primary-600: #4338ca;
                    --border: #e5e7eb;
                    --ok: #16a34a;
                    --warn: #d97706;
                }
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
                    background: radial-gradient(1200px 600px at 90% -10%, rgba(79,70,229,0.25), transparent 60%),
                                radial-gradient(800px 400px at -10% 10%, rgba(16,185,129,0.18), transparent 60%),
                                var(--bg);
                    color: var(--text);
                }
                .container { max-width: 980px; margin: 0 auto; padding: 24px; }
                .nav {
                    display: flex; align-items: center; justify-content: space-between;
                    gap: 12px; padding: 16px 0;
                }
                .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
                .chip { font-size: 12px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); }
                .actions { display: flex; gap: 10px; align-items: center; }
                .btn {
                    appearance: none; border: 1px solid var(--border); background: var(--card); color: var(--text);
                    padding: 10px 14px; border-radius: 10px; cursor: pointer; text-decoration: none; font-weight: 600;
                    box-shadow: 0 1px 0 rgba(255,255,255,0.02) inset, 0 10px 30px rgba(0,0,0,0.15);
                    transition: transform .06s ease, background .2s ease, border-color .2s ease;
                }
                .btn:hover { transform: translateY(-1px); border-color: var(--primary); }
                .btn-primary { background: linear-gradient(180deg, var(--primary), var(--primary-600)); border-color: transparent; color: #fff; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 20px; }
                .card { background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)), var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 18px; }
                .muted { color: var(--muted); }
                .kvs { display: grid; grid-template-columns: 120px 1fr; gap: 8px 16px; margin-top: 12px; font-size: 14px; }
                .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--border); }
                .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
                .dot.ok { background: var(--ok); }
                .dot.warn { background: var(--warn); }
                .footer { margin-top: 26px; font-size: 12px; color: var(--muted); }
                .toggle { display: inline-flex; align-items: center; gap: 8px; }
            </style>
            <script>
                (function() {
                    const saved = localStorage.getItem('theme');
                    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                    const theme = saved || (prefersDark ? 'dark' : 'light');
                    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
                    window.__toggleTheme = function() {
                        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
                        const next = isLight ? 'dark' : 'light';
                        if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
                        else document.documentElement.removeAttribute('data-theme');
                        localStorage.setItem('theme', next);
                        const btn = document.getElementById('theme-label');
                        if (btn) btn.textContent = next === 'light' ? 'Modo escuro' : 'Modo claro';
                    }
                    document.addEventListener('DOMContentLoaded', function() {
                        const btn = document.getElementById('theme-label');
                        if (btn) btn.textContent = (document.documentElement.getAttribute('data-theme') === 'light') ? 'Modo escuro' : 'Modo claro';
                    });
                })();
            </script>
        </head>
        <body>
            <div class="container">
                <div class="nav">
                    <div class="brand">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2C6.477 2 2 6.203 2 11.39c0 2.829 1.372 5.36 3.56 7.062L4.5 22l3.86-1.274A10.3 10.3 0 0 0 12 20.78c5.523 0 10-4.203 10-9.39C22 6.203 17.523 2 12 2Z" stroke="currentColor" stroke-width="1.3"/>
                            <path d="M8.5 9.5c0-.552.53-1 1.185-1h.79c.329 0 .64.12.87.335l.322.298c.29.268.298.703.017.98l-.47.463a.9.9 0 0 0-.263.64v.07c0 .497.43.9.96.9h.86c.655 0 1.185.448 1.185 1s-.53 1-1.185 1H10c-1.38 0-2.5-1.007-2.5-2.25V9.5Z" fill="currentColor"/>
                        </svg>
                        Uadezap API
                        <span class="chip">v${VERSION}</span>
                    </div>
                    <div class="actions">
                        <button class="btn" onclick="__toggleTheme()"><span id="theme-label">Alternar tema</span></button>
                        <a class="btn" href="/status">Status JSON</a>
                        <a class="btn btn-primary" href="/connect">Conectar</a>
                    </div>
                </div>

                <div class="grid">
                    <div class="card">
                        <h2 style="margin: 0 0 6px 0;">Status</h2>
                        <div class="muted">Situação do WhatsApp e ambiente</div>
                        <div style="margin-top: 12px; display: flex; gap: 10px; align-items: center;">
                            <span class="badge"><span class="dot ${sock ? 'ok' : 'warn'}"></span>${sock ? 'Conectado' : 'Desconectado'}</span>
                            <span class="badge"><span class="dot ok"></span>Node ${process.version}</span>
                        </div>
                        <div class="kvs">
                            <div class="muted">Porta</div><div>${process.env.PORT || 8080}</div>
                            <div class="muted">QR Code</div><div>${qrCodeData ? 'Disponível' : (sock ? '—' : 'Aguardando')}</div>
                        </div>
                        <div style="margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap;">
                            <a class="btn" href="/qrcode">Ver QR Code</a>
                            <a class="btn" href="/connect">${sock ? 'Reconectar' : 'Iniciar conexão'}</a>
                        </div>
                    </div>
                    <div class="card">
                        <h2 style="margin: 0 0 6px 0;">Como usar</h2>
                        <div class="muted">Endpoints rápidos</div>
                        <div class="kvs">
                            <div class="muted">GET</div><div><code>/connect</code> — inicia a sessão</div>
                            <div class="muted">GET</div><div><code>/qrcode</code> — exibe o QR code</div>
                            <div class="muted">GET</div><div><code>/status</code> — status em JSON</div>
                            <div class="muted">POST</div><div><code>/send-text</code> — enviar mensagem</div>
                        </div>
                    </div>
                </div>

                <div class="footer">© 2025 Uadezap • Baileys • Easypanel Ready _ desenvolvido por Luan Souza de Siqueira - 2025</div>
            </div>
        </body>
        </html>
    `);
});

// Status em JSON
app.get('/status', (req, res) => {
    res.json({
        status: sock ? 'connected' : 'disconnected',
        qr: !!qrCodeData,
        version: VERSION,
        node_version: process.version,
        port: process.env.PORT || 8080
    });
});

// Conectar ao WhatsApp
app.get('/connect', async (req, res) => {
    if (!makeWASocket) {
        return res.status(500).json({ error: 'Baileys não carregado. Verifique o Node.js e dependências.' });
    }
    if (sock) return res.json({ status: 'already connected' });

    try {
        await connectToWhatsApp(); // Chama a função para iniciar a conexão
        res.json({ status: 'connecting', qrcode: !!qrCodeData });
    } catch (err) {
        console.error('❌ Erro no /connect:', err);
        res.status(500).json({ error: 'Erro ao iniciar conexão', details: err.message });
    }
});

// Mostrar QR Code
app.get('/qrcode', (req, res) => {
    if (!makeWASocket) {
        return res.status(500).send('<h3>❌ API carregando... Aguarde.</h3>');
    }
    res.type('html');
    const hasQr = !!qrCodeData;
    const connected = !!sock;
    res.send(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>QR Code • Uadezap</title>
            <meta http-equiv="refresh" content="5" />
            <style>
                :root { --bg:#0b1220; --card:#111a2b; --text:#e6edf3; --muted:#9fb0c3; --primary:#4f46e5; --border:#22304a; }
                html[data-theme="light"] { --bg:#f6f7fb; --card:#ffffff; --text:#0b1220; --muted:#536174; --primary:#4f46e5; --border:#e5e7eb; }
                body{ margin:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
                .container{ max-width:860px; margin:0 auto; padding:24px; }
                .nav{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 0; }
                .btn{ appearance:none; border:1px solid var(--border); background:var(--card); color:var(--text); padding:10px 14px; border-radius:10px; cursor:pointer; text-decoration:none; font-weight:600; }
                .grid{ display:grid; grid-template-columns: 1fr; gap:16px; }
                .card{ background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px; }
                .muted{ color:var(--muted); }
                .qrwrap{ display:flex; align-items:center; justify-content:center; min-height:300px; }
            </style>
            <script>
                (function(){
                    const saved = localStorage.getItem('theme');
                    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                    const theme = saved || (prefersDark ? 'dark' : 'light');
                    if (theme === 'light') document.documentElement.setAttribute('data-theme','light');
                    window.__toggleTheme = function(){
                        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
                        const next = isLight ? 'dark' : 'light';
                        if (next === 'light') document.documentElement.setAttribute('data-theme','light'); else document.documentElement.removeAttribute('data-theme');
                        localStorage.setItem('theme', next);
                        const btn = document.getElementById('theme-label');
                        if (btn) btn.textContent = next === 'light' ? 'Modo escuro' : 'Modo claro';
                    }
                    document.addEventListener('DOMContentLoaded', function(){
                        const btn = document.getElementById('theme-label');
                        if (btn) btn.textContent = (document.documentElement.getAttribute('data-theme') === 'light') ? 'Modo escuro' : 'Modo claro';
                    });
                })();
            </script>
        </head>
        <body>
            <div class="container">
                <div class="nav">
                    <div style="font-weight:700; display:flex; align-items:center; gap:10px;">Uadezap • QR Code</div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="btn" onclick="__toggleTheme()"><span id="theme-label">Alternar tema</span></button>
                        <a class="btn" href="/">Início</a>
                        <a class="btn" href="/connect">Conectar</a>
                    </div>
                </div>
                <div class="grid">
                    <div class="card">
                        <div class="muted">Status: ${connected ? 'Conectado' : (hasQr ? 'Aguardando leitura' : 'Aguardando conexão')}</div>
                        <div class="qrwrap">
                            ${hasQr ? `<img src="${qrCodeData}" width="320" height="320" style="border-radius:12px; border:1px solid var(--border)" />` : `<div class="muted">${connected ? 'Nenhum QR Code disponível' : 'Vá para /connect para gerar o QR Code.'}</div>`}
                        </div>
                        <div class="muted">A página atualiza automaticamente a cada 5 segundos.</div>
                    </div>
                </div>
                <div style="margin-top: 26px; font-size: 12px; color: var(--muted);">© 2025 Uadezap • Baileys • Easypanel Ready _ desenvolvido por Luan Souza de Siqueira - 2025</div>
            </div>
        </body>
        </html>
    `);
});

// Enviar mensagem (POST)
app.post('/send-text', auth, async (req, res) => {
    const { number, message } = req.body;
    if (!sock) return res.status(500).json({ error: 'WhatsApp desconectado.' });
    if (!number || !message) return res.status(400).json({ error: 'Campos obrigatórios: number, message' });

    try {
        const id = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(id, { text: message });
        res.json({ success: true, to: id, message });
    } catch (err) {
        console.error('❌ Erro ao enviar:', err);
        res.status(500).json({ error: err.message });
    }
});

// Enviar imagem
app.post('/send-image', auth, async (req, res) => {
    const { number, image, caption } = req.body;
    if (!sock) return res.status(500).json({ error: 'WhatsApp desconectado.' });
    if (!number || !image) return res.status(400).json({ error: 'Campos obrigatórios: number, image' });

    try {
        const id = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

        let imageBuffer;
        // Verifica se é uma URL (começa com http ou https)
        if (image.startsWith('http://') || image.startsWith('https://')) {
            customLog('🔄 Baixando imagem de URL...');
            const response = await axios.get(image, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data);
            customLog(`✅ Imagem baixada de URL: ${imageBuffer.length} bytes`);
        } else if (image.startsWith('data:image/')) {
            // Se é base64, converter para buffer (removendo o prefixo data:image/...)
            customLog('🔄 Decodificando imagem Base64...');
            imageBuffer = Buffer.from(image.split(',')[1], 'base64');
            customLog(`✅ Imagem Base64 decodificada: ${imageBuffer.length} bytes`);
        } else {
            // Assumir que é uma string base64 pura (sem prefixo)
            customLog('🔄 Decodificando imagem Base64 (sem prefixo)...');
            imageBuffer = Buffer.from(image, 'base64');
            customLog(`✅ Imagem Base64 decodificada: ${imageBuffer.length} bytes`);
        }

        await sock.sendMessage(id, {
            image: imageBuffer,
            caption: caption || ''
        });
        customLog(`📤 Imagem enviada para: ${id}`);
        res.json({
            success: true,
            to: id,
            type: 'image',
            instance: sock.user?.id || 'unknown',
            instanceName: sock.user?.name || 'Unknown'
        });
    } catch (err) {
        customLog('❌ Erro ao enviar imagem:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Enviar vídeo
app.post('/send-video', auth, async (req, res) => {
    const { number, video, caption } = req.body;
    if (!sock) return res.status(500).json({ error: 'WhatsApp desconectado.' });
    if (!number || !video) return res.status(400).json({ error: 'Campos obrigatórios: number, video' });

    try {
        const id = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

        let videoBuffer;
        // Verifica se é uma URL (começa com http ou https)
        if (video.startsWith('http://') || video.startsWith('https://')) {
            customLog('🔄 Baixando vídeo de URL...');
            const response = await axios.get(video, { responseType: 'arraybuffer' });
            videoBuffer = Buffer.from(response.data);
            customLog(`✅ Vídeo baixado de URL: ${videoBuffer.length} bytes`);
        } else if (video.startsWith('data:video/')) {
            // Se é base64, converter para buffer (removendo o prefixo data:video/...)
            customLog('🔄 Decodificando vídeo Base64...');
            videoBuffer = Buffer.from(video.split(',')[1], 'base64');
            customLog(`✅ Vídeo Base64 decodificado: ${videoBuffer.length} bytes`);
        } else {
            // Assumir que é uma string base64 pura (sem prefixo)
            customLog('🔄 Decodificando vídeo Base64 (sem prefixo)...');
            videoBuffer = Buffer.from(video, 'base64');
            customLog(`✅ Vídeo Base64 decodificado: ${videoBuffer.length} bytes`);
        }

        await sock.sendMessage(id, {
            video: videoBuffer,
            caption: caption || ''
        });
        customLog(`📤 Vídeo enviado para: ${id}`);
        res.json({
            success: true,
            to: id,
            type: 'video',
            instance: sock.user?.id || 'unknown',
            instanceName: sock.user?.name || 'Unknown'
        });
    } catch (err) {
        customLog('❌ Erro ao enviar vídeo:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Enviar áudio
app.post('/send-audio', auth, async (req, res) => {
    const { number, audio, ptt = false } = req.body;
    if (!sock) return res.status(500).json({ error: 'WhatsApp desconectado.' });
    if (!number || !audio) return res.status(400).json({ error: 'Campos obrigatórios: number, audio' });

    try {
        const id = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

        let audioBuffer;
        
        // Verifica se é uma URL (começa com http ou https)
        if (audio.startsWith('http://') || audio.startsWith('https://')) {
            customLog('🔄 Baixando áudio de URL...');
            const response = await axios.get(audio, { responseType: 'arraybuffer' });
            audioBuffer = Buffer.from(response.data);
            customLog(`✅ Áudio baixado de URL: ${audioBuffer.length} bytes`);
        } else if (audio.startsWith('data:audio/')) {
            // Se é base64, converter para buffer (removendo o prefixo data:audio/...)     
            customLog('🔄 Decodificando áudio Base64...');
            audioBuffer = Buffer.from(audio.split(',')[1], 'base64');
            customLog(`✅ Áudio Base64 decodificado: ${audioBuffer.length} bytes`);
        } else {
            // Assumir que é uma string base64 pura (sem prefixo)
            customLog('🔄 Decodificando áudio Base64 (sem prefixo)...');
            audioBuffer = Buffer.from(audio, 'base64');
            customLog(`✅ Áudio Base64 decodificado: ${audioBuffer.length} bytes`);
        }

        // --- Transcodificar para OPUS usando ffmpeg ---
        customLog('🔄 Transcodificando áudio para OPUS...');
        const opusBuffer = await new Promise((resolve, reject) => {
            let buffers = [];
            const { Readable } = require('stream');
            const audioStream = new Readable();
            audioStream.push(audioBuffer);
            audioStream.push(null); // Indica o fim do stream

            const command = ffmpeg(audioStream) // Passa o stream diretamente como entrada
                .inputFormat('mp3') // Assumindo que a entrada é MP3 do Eleven Labs
                .audioCodec('libopus')
                .audioChannels(1) // Mono para mensagens de voz
                .audioFrequency(16000) // Frequência comum para voz
                .outputFormat('ogg') // Contêiner OGG para Opus
                .on('error', (err) => {
                    customLog('❌ Erro na transcodificação ffmpeg:', err.message);
                    reject(new Error('Erro na transcodificação de áudio.'));
                })
                .on('end', () => {
                    customLog('✅ Áudio transcodificado para OPUS.');
                    resolve(Buffer.concat(buffers));
                })
                .pipe(
                    new require('stream').Writable({
                        write(chunk, encoding, callback) {
                            buffers.push(chunk);
                            callback();
                        },
                    }),
                    { end: true }
                );
        });

        await sock.sendMessage(id, {
            audio: opusBuffer,
            mimetype: 'audio/ogg; codecs=opus', // MimeType correto para Opus no OGG
            ptt: true // Forçar como mensagem de voz para melhor compatibilidade
        });

        customLog(`📤 Áudio OPUS enviado para: ${id} (PTT: true)`);

        res.json({
            success: true,
            to: id,
            type: 'audio',
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
            instance: sock.user?.id || 'unknown',
            instanceName: sock.user?.name || 'Unknown'
        });
    } catch (err) {
        customLog('❌ Erro ao enviar áudio:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Enviar documento (PDF, etc.)
app.post('/send-document', auth, async (req, res) => {
    const { number, document, filename, caption } = req.body;
    if (!sock) return res.status(500).json({ error: 'WhatsApp desconectado.' });
    if (!number || !document) return res.status(400).json({ error: 'Campos obrigatórios: number, document' });

    try {
        const id = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

        let documentBuffer;
        // Verifica se é uma URL (começa com http ou https)
        if (document.startsWith('http://') || document.startsWith('https://')) {
            customLog('🔄 Baixando documento de URL...');
            const response = await axios.get(document, { responseType: 'arraybuffer' });
            documentBuffer = Buffer.from(response.data);
            customLog(`✅ Documento baixado de URL: ${documentBuffer.length} bytes`);
        } else if (document.startsWith('data:application/')) {
            // Se é base64, converter para buffer (removendo o prefixo data:application/...)
            customLog('🔄 Decodificando documento Base64...');
            documentBuffer = Buffer.from(document.split(',')[1], 'base64');
            customLog(`✅ Documento Base64 decodificado: ${documentBuffer.length} bytes`);
        } else {
            // Assumir que é uma string base64 pura (sem prefixo)
            customLog('🔄 Decodificando documento Base64 (sem prefixo)...');
            documentBuffer = Buffer.from(document, 'base64');
            customLog(`✅ Documento Base64 decodificado: ${documentBuffer.length} bytes`);
        }

        await sock.sendMessage(id, {
            document: documentBuffer,
            fileName: filename || 'documento.pdf',
            caption: caption || ''
        });
        customLog(`📤 Documento enviado para: ${id} (${filename || 'documento.pdf'})`);
        res.json({
            success: true,
            to: id,
            type: 'document',
            filename: filename || 'documento.pdf',
            instance: sock.user?.id || 'unknown',
            instanceName: sock.user?.name || 'Unknown'
        });
    } catch (err) {
        customLog('❌ Erro ao enviar documento:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Enviar localização
app.post('/send-location', auth, async (req, res) => {
    const { number, latitude, longitude, name, address } = req.body;
    if (!sock) return res.status(500).json({ error: 'WhatsApp desconectado.' });
    if (!number || !latitude || !longitude) return res.status(400).json({ error: 'Campos obrigatórios: number, latitude, longitude' });

    try {
        const id = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

        await sock.sendMessage(id, {
            location: {
                degreesLatitude: parseFloat(latitude),
                degreesLongitude: parseFloat(longitude),
                name: name || '',
                address: address || ''
            }
        });
        customLog(`📤 Localização enviada para: ${id} (${latitude}, ${longitude})`);
        res.json({
            success: true,
            to: id,
            type: 'location',
            latitude,
            longitude,
            instance: sock.user?.id || 'unknown',
            instanceName: sock.user?.name || 'Unknown'
        });
    } catch (err) {
        customLog('❌ Erro ao enviar localização:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Webhook de teste
app.post('/webhook-receive', auth, (req, res) => {
    customLog('📤 Webhook recebido:', req.body);
    res.status(200).json({ received: true });
});
