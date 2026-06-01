# Guia Interactiva MICI

Aplicacion educativa para estudiar el examen de Metodos de Investigacion Cientifica en Informatica, basada en las clases 6, 8 y 9.

## Version estatica para Vercel

El sitio desplegable esta en `public/`. Vercel ejecuta:

```bash
npm run build
```

Ese comando copia `public/` a `dist/`, que es la carpeta publicada.

## Uso local

Para abrir la version estatica, abre `public/index.html` en el navegador.

Para usar la version con backend local:

```bash
./run.sh
```

Luego abre `http://127.0.0.1:8000/`.

## Contenido

- Teoria ampliada de las clases 6, 8 y 9.
- Banco de preguntas con respuestas correctas y explicaciones.
- Laboratorio grafico con SVG y Canvas.
- Simulador de examen con 30 preguntas por intento.
- Checklist con progreso guardado en `localStorage`.
