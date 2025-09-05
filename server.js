// server.js - API tipo Evolution API (Corrigido para ESM)

const express = require('express');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use('/auth', express.static('auth_info_baileys'));

let sock = null;
let qrCodeData = null;

// === Variáveis do Baileys (serão preenchidas com import) ===
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
        console.error('❌ Falha ao carregar Baileys:', err.message);
    }
})();
// ==========================================================

// === CONFIGURAÇÕES ===
const API_KEY = process.env.API_KEY || 'minha123senha';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // Opcional: envia msgs recebidas
const VERSION = '1.0.0';

// === MIDDLEWARE DE AUTENTICAÇÃO ===
const auth = (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (!makeWASocket) return res.status(500).json({ error: 'API ainda carregando...' });
    if (key !== API_KEY) {
        return res.status(401).json({ error: 'Acesso negado. Chave inválida.' });
    }
    next();
};

// === ROTAS ===

// Página inicial com status
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
        node_version: process.version
    });
});

// Conectar (gera QR Code)
app.get('/connect', async (req, res) => {
    if (!makeWASocket) {
        return res.status(500).json({ error: 'Baileys ainda carregando...' });
    }
    if (sock) return res.json({ status: 'already connected' });

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        browser: ['Uadezap API', 'Chrome', '1.0.2']
    });

    sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
        if (qr) QRCode.toDataURL(qr, (err, url) => { if (!err) qrCodeData = url; });
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
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key || msg.key.fromMe) return;

        const from = jidNormalizedUser(msg.key.remoteJid);
        const pushName = msg.pushName || 'Desconhecido';
        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     '[Mídia]';
        const timestamp = msg.messageTimestamp;

        const messageData = { from, pushName, text, timestamp, type: 'incoming' };

        console.log('📩 Recebido:', messageData);

        // Envia para webhook (ex: n8n)
        if (N8N_WEBHOOK_URL) {
            try {
                await axios.post(N8N_WEBHOOK_URL, messageData, {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                console.error('❌ Falha no webhook:', err.message);
            }
        }
    });

    res.json({ status: 'connecting', qrcode: qrCodeData ? 'waiting' : 'generating' });
});

// Mostrar QR Code
app.get('/qrcode', (req, res) => {
    if (!makeWASocket) {
        return res.status(500).send('<h3>❌ API carregando...</h3>');
    }
    if (qrCodeData) {
        res.type('html');
        res.send(`<img src="${qrCodeData}" width="300" /><meta http-equiv="refresh" content="5" />`);
    } else if (sock) {
        res.send('<h3>✅ Conectado! Não há QR Code disponível.</h3>');
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
        res.status(500).json({ error: err.message });
    }
});

// Receber mensagens (webhook - para testes)
app.post('/webhook-receive', auth, (req, res) => {
    console.log('📤 Webhook acionado:', req.body);
    res.status(200).json({ received: true });
});

// === INICIAR SERVIDOR ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
});