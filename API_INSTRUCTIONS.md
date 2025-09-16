# Uadezap API - Instruções e Exemplos cURL para N8N

Este documento fornece instruções e exemplos de comandos `cURL` para interagir com a API do Uadezap. Estes exemplos são ideais para configurar nós "HTTP Request" no N8N ou para testar a API diretamente via terminal.

---

## Configuração Geral

*   **URL Base:** Assumimos que sua API está rodando em `http://localhost:3000`. Se estiver em outro endereço (por exemplo, em um servidor remoto), substitua `http://localhost:3000` pela URL correta.
*   **Chave da API (`X-API-KEY`):** A chave de autenticação padrão é `minha123senha`. Certifique-se de usar a chave configurada no seu ambiente.
*   **Número de Telefone:** Substitua `5511999999999` pelo número de telefone real do destinatário, incluindo o código do país (55 para Brasil), o DDD (11 para São Paulo) e o número, sem caracteres especiais (ex: `5511999999999`).

---

## Endpoints e Exemplos

### 1. Enviar Mensagem de Texto (`POST /send-text`)

Envia uma mensagem de texto simples para um contato.

```bash
curl -X POST \
  http://localhost:3000/send-text \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "message": "Olá do N8N! Esta é uma mensagem de texto."
  }'
```

---

### 2. Enviar Imagem (`POST /send-image`)

Permite enviar uma imagem via URL ou em formato Base64.

#### Exemplo com URL da Imagem:

```bash
curl -X POST \
  http://localhost:3000/send-image \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "image": "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
    "caption": "Imagem de teste via URL do N8N"
  }'
```

#### Exemplo com Imagem em Base64:

```bash
# Nota: O valor de "image" em base64 é um exemplo muito curto.
# Em uma aplicação real, seria uma string base64 muito maior e válida de uma imagem.
curl -X POST \
  http://localhost:3000/send-image \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0EAwImjVAABUIQSPgLCPAAAAAElFTkSuQmCC",
    "caption": "Imagem de teste via Base64 do N8N"
  }'
```

---

### 3. Enviar Vídeo (`POST /send-video`)

Permite enviar um vídeo via URL ou em formato Base64.

#### Exemplo com URL do Vídeo:

```bash
# Nota: Substitua com uma URL de vídeo real e acessível.
curl -X POST \
  http://localhost:3000/send-video \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5522999569035",
    "video": "https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4",
    "caption": "Vídeo de teste via URL do N8N"
  }'
```

#### Exemplo com Vídeo em Base64:

```bash
# Nota: O valor de "video" em base64 é um exemplo muito curto.
# Em uma aplicação real, seria uma string base64 muito maior e válida de um vídeo.
curl -X POST \
  http://localhost:3000/send-video \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "video": "data:video/mp4;base64,GkXfo6EuFgABAAAAAmgAKGlhdmMAAAAAAAABAAEAAAAAAABhdmMxMDAuMDYuMDExMAAAAAAAAAATAAAAGGlwdGMAAAAAAAAAAAwAAAAgdm9scwAAA",
    "caption": "Vídeo de teste via Base64 do N8N"
  }'
```

---

### 4. Enviar Áudio (`POST /send-audio`)

Permite enviar um áudio via URL ou em formato Base64. Pode ser marcado como "PTT" (Push To Talk, áudio de voz).

#### Exemplo com URL do Áudio:

```bash
# Nota: Substitua com uma URL de áudio real e acessível.
curl -X POST \
  http://localhost:3000/send-audio \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "audio": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    "ptt": false
  }'
```

#### Exemplo com Áudio em Base64:

```bash
# Nota: O valor de "audio" em base64 é um exemplo muito curto.
# Em uma aplicação real, seria uma string base64 muito maior e válida de um áudio.
curl -X POST \
  http://localhost:3000/send-audio \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "audio": "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjM1LjEwMAAAAAAAAAAAAP/++C+vLwAAAAAPbGFtZQAJD4bRAACxAAAAADj",
    "ptt": true
  }'
```

---

### 5. Enviar Documento (`POST /send-document`)

Permite enviar um documento (PDF, DOCX, etc.) via URL ou em formato Base64.

#### Exemplo com URL do Documento:

```bash
# Nota: Substitua com uma URL de documento real e acessível (ex: PDF).
curl -X POST \
  http://localhost:3000/send-document \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "document": "https://www.africau.edu/images/default/sample.pdf",
    "filename": "meu_documento_n8n.pdf",
    "caption": "Documento de teste via URL do N8N"
  }'
```

#### Exemplo com Documento em Base64:

```bash
# Nota: O valor de "document" em base64 é um exemplo muito curto.
# Em uma aplicação real, seria uma string base64 muito maior e válida de um documento.
curl -X POST \
  http://localhost:3000/send-document \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "document": "data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsSBLi4uLgo0IDAgT2JqCjw8L0xlbmd0aCA1IDAgUi9GaWx0ZX",
    "filename": "documento_base64_n8n.pdf",
    "caption": "Documento de teste via Base64 do N8N"
  }'
```

---

### 6. Enviar Localização (`POST /send-location`)

Envia uma localização com latitude, longitude, nome e endereço.

```bash
curl -X POST \
  http://localhost:3000/send-location \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: minha123senha' \
  -d '{
    "number": "5511999999999",
    "latitude": -23.5505,
    "longitude": -46.6333,
    "name": "Museu de Arte de São Paulo (MASP)",
    "address": "Avenida Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200"
  }'
```

---
