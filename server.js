// server.js - API WhatsApp tipo Evolution (ESM Safe + Easypanel Ready)

const express = require('express');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const axios = require('axios');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use('/auth', express.static('auth_info_baileys'));

let sock = null;
let qrCodeData = null;

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
        console.log('✅ Baileys carregado com sucesso');
    } catch (err) {
        console.error('❌ Falha ao carregar @whiskeysockets/baileys:', err.message);
        console.error('💡 Certifique-se de que o pacote está instalado: npm install @whiskeysockets/baileys');
    }
})();
// ==========================================================

// === CONFIGURAÇÕES ===
const API_KEY = process.env.API_KEY || 'minha123senha';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || null;
const VERSION = '1.0.0';

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
        <h1>🚀 Uadezap API v${VERSION}</h1>
        <p>Status: <strong>${sock ? 'Conectado' : 'Desconectado'}</strong></p>
        <ul>
            <li><a href="/connect">Conectar</a></li>
            <li><a href="/qrcode">Ver QR Code</a></li>
            <li><a href="/status">Status (JSON)</a></li>
        </ul>
        <hr>
        <small>Node.js: ${process.version} | Baileys</small>
    `);
});

// Status em JSON
app.get('/status', (req, res) => {
    res.json({
        status: sock ? 'connected' : 'disconnected',
        qr: !!qrCodeData,
        version: VERSION,
        node_version: process.version,
        port: process.env.PORT || 3000
    });
});

// Conectar ao WhatsApp
app.get('/connect', async (req, res) => {
    if (!makeWASocket) {
        return res.status(500).json({ error: 'Baileys não carregado. Verifique o Node.js e dependências.' });
    }
    if (sock) return res.json({ status: 'already connected' });

    try {
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
                console.log('✅ WhatsApp conectado!');
                qrCodeData = null;
            }

            if (connection === 'close') {
                const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('🔁 Reconectando...');
                    setTimeout(() => {
                        sock = null;
                        qrCodeData = null;
                        app.get('/connect');
                    }, 3000);
                } else {
                    console.log('❌ Conexão encerrada. Faça login novamente.');
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.key || msg.key.fromMe) return;

            const from = jidNormalizedUser(msg.key.remoteJid);
            const pushName = msg.pushName || 'Desconhecido';
            const textContent = msg.message?.conversation ||
                                msg.message?.extendedTextMessage?.text ||
                                msg.message?.imageMessage?.caption ||
                                msg.message?.documentMessage?.caption ||
                                '[Mídia ou tipo não suportado]';
            const timestamp = msg.messageTimestamp;

            const messageData = {
                from,
                pushName,
                text: textContent.trim(),
                timestamp,
                type: 'incoming'
            };

            console.log('📩 Recebido:', messageData);

            if (N8N_WEBHOOK_URL) {
                try {
                    await axios.post(N8N_WEBHOOK_URL, messageData, {
                        timeout: 5000,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    console.log(`✅ Enviado para webhook: ${from}`);
                } catch (err) {
                    console.error('❌ Falha ao enviar ao n8n:', err.message);
                }
            }
        });

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
    if (qrCodeData) {
        res.type('html');
        res.send(`
            <img src="${qrCodeData}" width="300" />
            <p><small>Escaneie com o WhatsApp → Dispositivos vinculados</small></p>
            <meta http-equiv="refresh" content="5" />
        `);
    } else if (sock) {
        res.send('<h3>✅ Conectado! Nenhum QR Code disponível.</h3>');
    } else {
        res.status(400).send('<h3>❌ Não há QR Code. Vá para <a href="/connect">/connect</a></h3>');
    }
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

// Webhook de teste
app.post('/webhook-receive', auth, (req, res) => {
    console.log('📤 Webhook recebido:', req.body);
    res.status(200).json({ received: true });
});

// === INICIAR SERVIDOR ===
const PORT = parseInt(process.env.PORT) || 8080;
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Acesse: http://<seu-ip>:${PORT}/connect`);
});