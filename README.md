# Button Race Realtime V3

Aplicación web de pulsadores en tiempo real para concursos, trivias y dinámicas.

## Incluye

- Salas por código
- Administrador y jugadores
- Socket.IO en tiempo real
- Cuenta regresiva 3, 2, 1
- Orden decidido por el servidor
- Tiempo de respuesta por ronda
- Código QR para entrar directamente a la sala
- Podio en vivo para 1.º, 2.º y 3.º lugar
- Sonidos de cuenta regresiva, ¡YA! y pulsación
- Botón para activar/desactivar sonido
- Historial de rondas
- Reconexión de jugadores
- Sin sistema de puntos

## Ejecutar

```bash
npm install
npm start
```

Administrador:

```text
http://localhost:3000/admin
```

Jugador:

```text
http://localhost:3000/player
```

## Render

Build Command:

```text
npm install
```

Start Command:

```text
node server.js
```

Al subir estos cambios a GitHub, Render puede desplegarlos automáticamente.

## Nota

Las salas y el historial se guardan en memoria. Si el servidor se reinicia, se eliminan.
