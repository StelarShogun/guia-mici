# Guia Interactiva MICI

Aplicacion educativa para estudiar el examen de Metodos de Investigacion Cientifica en Informatica, basada en las clases 6, 8 y 9.

## Despliegue en Vercel

Este repositorio esta preparado como sitio estatico. Vercel debe usar:

- Framework preset: Other
- Build command: `npm run build`
- Output directory: `dist`

El comando de build copia el contenido de `public/` a `dist/`:

```bash
npm run build
```

## Uso local

Para abrir la version estatica, abre `public/index.html` en el navegador.

## Contenido

- Teoria ampliada de las clases 6, 8 y 9.
- Banco de preguntas con respuestas correctas y explicaciones.
- Laboratorio grafico con SVG y Canvas.
- Simulador de examen con 30 preguntas por intento.
- Checklist con progreso guardado en `localStorage`.
