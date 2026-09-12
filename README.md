# Button Race Realtime

Aplicación web de pulsadores para concursos, trivias, clases y dinámicas.

## Tecnología

- Node.js
- Express
- Socket.IO
- HTML, CSS y JavaScript sin framework

## Ejecutar localmente

1. Instala Node.js 18 o superior.
2. Abre una terminal dentro de esta carpeta.
3. Ejecuta:

```bash
npm install
npm start
```

4. Abre:
   - Inicio: http://localhost:3000
   - Administrador: http://localhost:3000/admin
   - Jugador: http://localhost:3000/player

## Probar desde otro celular o computadora en la misma Wi‑Fi

El equipo que ejecuta Node.js debe aceptar conexiones en el puerto 3000.

Busca la IP local del equipo servidor. En Windows puedes usar:

```bash
ipconfig
```

Si la IP es, por ejemplo, `192.168.1.50`, los otros dispositivos deben abrir:

```text
http://192.168.1.50:3000/player
```

El administrador puede usar:

```text
http://192.168.1.50:3000/admin
```

Todos los dispositivos deben estar en la misma red local.

## Publicación

Este proyecto puede desplegarse en servicios compatibles con Node.js y WebSockets, por ejemplo Render, Railway, Fly.io o un VPS.

Comando de inicio:

```bash
npm start
```

La plataforma debe exponer la variable `PORT`; el servidor ya la utiliza automáticamente.

## Cómo se determina el orden

El navegador NO decide la posición. Cada pulsación viaja por Socket.IO al servidor.

El servidor:

1. recibe la pulsación;
2. usa un reloj monotónico de alta resolución (`process.hrtime.bigint()`);
3. compara el momento de recepción con el inicio de la ronda;
4. asigna la siguiente posición disponible;
5. transmite el resultado a todos los clientes.

Esto evita confiar en los relojes de celulares o computadoras.

## Persistencia

Actualmente las salas y el historial viven en memoria. Si el servidor se reinicia, se pierden.

Para producción con múltiples instancias se recomienda:
- Redis para estado compartido y adaptador de Socket.IO;
- PostgreSQL/MySQL para historial permanente.
