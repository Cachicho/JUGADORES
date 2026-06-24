# 🎰 TODO YAMBA — Hub de Juegos Recreativos

Plataforma multijugador en tiempo real (Ruleta Europea + Intermedio / In-Between) para jugar con amigos. Sin dinero real, 100% recreativo.

## Arquitectura

- **Servidor**: Node.js + Express + Socket.io. Es la única fuente de verdad: genera los giros de ruleta y las cartas con `crypto.randomBytes` (servidor), valida cada apuesta, y mueve los saldos. El navegador nunca decide un resultado.
- **Seguridad**: `helmet` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) + CORS restringido al dominio configurado en `APP_URL`.
- **Persistencia opcional**: `supabase/schema.sql` define tablas con RLS para guardar historial/transacciones si quieres conectar Supabase. Si no lo configuras, el hub funciona igual pero todo vive en memoria (se reinicia si reinicias el servidor).

## Ejecutar en local

```bash
cd todo-yamba-hub
cp .env.example .env        # edita ADMIN_PIN y APP_URL si quieres
npm install
npm start
```

Abre `http://localhost:3402` en varias pestañas/dispositivos (todos en la misma red o todos accediendo a la URL pública) para jugar juntos en tiempo real.

- **Crear sala**: pestaña "Crear sala (admin)", pide el PIN definido en `ADMIN_PIN`.
- **Unirse**: pestaña "Unirme a una sala", con el código de 5 caracteres que generó el administrador.

## Desplegar gratis

### Render.com (recomendado, soporta WebSockets)
1. Sube esta carpeta a un repositorio de GitHub.
2. En Render → "New Web Service" → conecta el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Agrega las variables de entorno (`ADMIN_PIN`, `APP_URL` = la URL que te da Render, `STARTING_BALANCE`).
5. Listo — Render te da una URL `https://tu-app.onrender.com`.

### Glitch.com
1. Importa el proyecto desde GitHub o sube los archivos.
2. Configura las variables de entorno en el panel `.env` de Glitch.
3. Glitch detecta `npm start` automáticamente.

### Vercel
Vercel no soporta servidores Socket.io persistentes en su plan gratuito estándar (funciones serverless no mantienen conexiones WebSocket abiertas). Usa Render o Glitch para este proyecto, o adapta el transporte a polling-only si insistes en Vercel (más latencia, no recomendado).

## Variables de entorno

Ver `.env.example`. Las más importantes:
- `ADMIN_PIN`: solo tú debes conocerlo, es lo que da control total (recargar/bajar fichas, iniciar rondas).
- `APP_URL`: debe coincidir EXACTO con la URL pública real (protocolo + dominio + puerto) o el CORS bloqueará todo.

## Estructura del proyecto

```
todo-yamba-hub/
├── server.js              # Express + Socket.io + seguridad + orquestación de salas
├── lib/
│   ├── rooms.js            # Gestión de salas y jugadores en memoria
│   ├── roulette.js         # RNG seguro, validación y liquidación de apuestas
│   ├── deck.js             # Mazo de 52 cartas con shuffle criptográfico
│   └── intermedio.js       # Lógica completa de In-Between (antes, turnos, poste, par)
├── public/
│   ├── index.html          # Hub + Lobby + Ruleta + Intermedio (una sola página)
│   ├── css/style.css
│   └── js/
│       ├── app.js           # Socket, navegación, panel admin
│       ├── roulette.js      # UI de la ruleta (rueda SVG + tablero)
│       └── intermedio.js    # UI del Intermedio (cartas, turnos, pozo)
└── supabase/schema.sql      # Esquema con RLS (persistencia opcional)
```
