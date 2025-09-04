// server.js
const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const axios = require('axios'); // Para enviar ao n8n
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use('/auth', express.static('auth_info_baileys'));

let sock = null;
let qrCodeData = null;

// Middleware de autenticação
const requireAuth = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key || key !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Acesso negado. Chave API inválida.' });
    }
    next();
};

// URL do webhook do n8n (substitua pelo seu!)
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://seu-webhook.n8n.cloud/webhook';

// Função para formatar número
const formatNumber = (jid) => jid?.split('@')[0];

// Rota: Iniciar conexão
app.get('/connect', async (req, res) => {
    if (sock) {
        return res.send('<h3>✅ Já conectado ao WhatsApp!</h3>');
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            // Recomendado para Node.js 22+
            browser: ['Uadezap API', 'Chrome', '1.0.0'],
        });

        sock.ev.on('connection.update', (update) => {
            const { qr, connection, lastDisconnect } = update;

            if (qr) {
                QRCode.toDataURL(qr, (err, url) => {
                    if (!err) qrCodeData = url;
                });
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp conectado com sucesso!');
                qrCodeData = null;
            }

            if (connection === 'close') {
                const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('🔁 Tentando reconectar...');
                    setTimeout(() => {
                        sock = null;
                        qrCodeData = null;
                        app.get('/connect', async (req, res) => {});
                    }, 3000);
                } else {
                    console.log('❌ Conexão encerrada. Faça login novamente.');
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Escuta mensagens recebidas
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.key || msg.key.fromMe) return; // Ignora mensagens próprias

            const from = msg.key.remoteJid;
            const fromUser = jidNormalizedUser(from);
            const pushName = msg.pushName || 'Desconhecido';
            const textContent = msg.message?.conversation ||
                                msg.message?.extendedTextMessage?.text ||
                                msg.message?.imageMessage?.caption ||
                                msg.message?.documentMessage?.caption ||
                                '[Mídia ou tipo não suportado]';

            const messageData = {
                type: 'whatsapp-message',
                from: fromUser,
                fromMe: false,
                text: textContent.trim(),
                timestamp: msg.messageTimestamp,
                pushName: pushName,
                raw: msg
            };

            console.log('📩 Recebido:', messageData);

            // Envia para o n8n
            try {
                await axios.post(N8N_WEBHOOK_URL, messageData, {
                    timeout: 5000,
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log(`✅ Enviado para n8n: ${fromUser}`);
            } catch (err) {
                console.error('❌ Falha ao enviar ao n8n:', err.message);
            }
        });

        res.send(`
            <h2>📲 Conectando ao WhatsApp...</h2>
            <p>Aguarde o QR Code aparecer em <a href="/qrcode">/qrcode</a></p>
        `);
    } catch (error) {
        console.error('❌ Erro ao conectar:', error);
        res.status(500).send('<h3>Erro ao iniciar conexão. Veja o log.</h3>');
    }
});

// Rota: Mostrar QR Code
app.get('/qrcode', (req, res) => {
    if (qrCodeData) {
        res.type('html');
        res.send(`
            <img src="${qrCodeData}" alt="QR Code" style="width:300px;" />
            <p><small>Escaneie com o WhatsApp → Dispositivos vinculados</small></p>
            <meta http-equiv="refresh" content="5;url=/qrcode" />
        `);
    } else if (sock) {
        res.send('<h3>✅ Você já está conectado ao WhatsApp!</h3>');
    } else {
        res.status(400).send('<h3>❌ Nenhuma conexão iniciada. Vá para <a href="/connect">/connect</a></h3>');
    }
});

// Rota: Enviar mensagem
app.get('/send', requireAuth, async (req, res) => {
    const { number, text } = req.query;

    if (!sock) {
        return res.status(500).json({ error: 'WhatsApp não está conectado.' });
    }
    if (!number || !text) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: number, text' });
    }

    try {
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text });
        res.json({
            success: true,
            to: jid,
            message: text
        });
    } catch (err) {
        console.error('❌ Erro ao enviar:', err);
        res.status(500).json({ error: err.message });
    }
});

// Rota inicial
app.get('/', (req, res) => {
    const version = '1.0.1'; // <-- Mude aqui quando atualizar
    res.send(`
        <h1>🚀 Uadezap API - WhatsApp</h1>
        <ul>
            <li><a href="/connect">Conectar ao WhatsApp</a></li>
            <li><a href="/qrcode">Ver QR Code</a></li>
            <li><a href="/send?number=5511999998888&text=Ol%C3%A1" target="_blank">Enviar mensagem de teste</a></li>
        </ul>
        <p><small>Use o header <code>x-api-key: sua_senha</code> nas requisições.</small></p>
        <hr>
        <footer>
            <p><small>📘 API Versão: <strong>${version}</strong> | Node.js: ${process.version} | Baileys</small></p>
        </footer>
    `);
});

// Porta dinâmica (obrigatório no Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
});