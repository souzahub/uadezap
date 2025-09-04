// server.js
const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const app = express();

app.use(express.json());
app.use('/auth', express.static('auth_info_baileys')); // Para acessar arquivos de sessão (opcional)

let sock = null;
let qrCodeData = null;

// Middleware para proteger rotas com API_KEY
const requireAuth = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Acesso negado. Chave API inválida.' });
    }
    next();
};

// Rota: Iniciar conexão
app.get('/connect', async (req, res) => {
    if (sock) return res.send('<h3>✅ Já conectado ao WhatsApp!</h3>');

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
    });

    sock.ev.on('connection.update', (update) => {
        const { qr, connection, lastDisconnect } = update;
        if (qr) {
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) qrCodeData = url;
            });
        }
        if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp!');
            qrCodeData = null;
        }
        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔁 Reconectando...');
                setTimeout(() => {
                    sock = null;
                    qrCodeData = null;
                    app.get('/connect', async (req, res) => {});
                }, 3000);
            } else {
                console.log('❌ Desconectado. Faça login novamente.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', ({ messages }) => {
        console.log('📩 Mensagem recebida:', messages[0]?.message);
    });

    res.send(`
        <h2>📲 Conectando ao WhatsApp...</h2>
        <p>Acesse <a href="/qrcode">/qrcode</a> para escanear o QR Code</p>
    `);
});

// Rota: Mostrar QR Code
app.get('/qrcode', async (req, res) => {
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
        res.send('<h3>❌ Nenhuma conexão iniciada. Vá para <a href="/connect">/connect</a></h3>');
    }
});

// Rota: Enviar mensagem
app.get('/send', requireAuth, async (req, res) => {
    const { number, text } = req.query;
    if (!sock || !number || !text) {
        return res.status(400).json({ error: 'Parâmetros ausentes: number e text' });
    }

    try {
        await sock.sendMessage(`${number}@s.whatsapp.net`, { text });
        res.json({ success: true, to: number, message: text });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rota inicial
app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 Minha API WhatsApp</h1>
        <ul>
            <li><a href="/connect">Conectar ao WhatsApp</a></li>
            <li><a href="/qrcode">Ver QR Code</a></li>
            <li><a href="/send?number=5511999998888&text=oi&x-api-key=minha123senha">Enviar mensagem de teste</a></li>
        </ul>
        <p><small>Use o header <code>x-api-key: minha123senha</code> nas suas requisições.</small></p>
    `);
});

// Porta dinâmica (obrigatório no Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});