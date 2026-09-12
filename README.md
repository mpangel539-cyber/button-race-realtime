# Button Race Realtime

Aplicación web de pulsadores en tiempo real para concursos, trivias y dinámicas.

## Incluye
- Salas por código
- Administrador y jugadores
- Socket.IO en tiempo real
- Contador sincronizado 3, 2, 1
- Orden decidido por el servidor
- Tiempo de reacción
- Marcador acumulado: 1.º = 3 pts, 2.º = 2 pts, 3.º = 1 pt
- Reinicio de puntos
- Historial de rondas
- Reconexión de jugadores
- Diseño responsive

## Ejecutar
```bash
npm install
npm start
```

Administrador: `http://localhost:3000/admin`
Jugador: `http://localhost:3000/player`

## Render
Build command: `npm install`
Start command: `node server.js`

Las salas, puntos e historial viven en memoria y se reinician si el servidor se reinicia.
