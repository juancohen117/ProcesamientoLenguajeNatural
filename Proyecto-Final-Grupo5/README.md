# Jaleco Sports · Agente de postventa

Proyecto final de Procesamiento de Lenguaje Natural · Grupo 5 · UNAL Manizales.

Jaleco Sports es una tienda ficticia de artículos deportivos. El agente transforma un reclamo redactado en español en una solicitud estructurada, consulta el pedido, explica la regla aplicable y permite radicar el caso con confirmación explícita.

## Archivos de la entrega

```text
Proyecto-Final-Grupo5/
├── README.md
├── SPEC.md
├── PLAN.md
├── TASKS.md
├── AGENTS.md
├── Presentacion.pdf
├── Presentacion.tex
├── compose.yaml
├── .env.example
├── n8n/
│   ├── workflow.json
│   ├── consultar-pedido.json
│   └── db/
│       ├── init.sql
│       └── 002-chat-memory.sql
├── app/
│   ├── app.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── skills/
│   ├── reglas-postventa/SKILL.md
│   └── contrato-radicacion/SKILL.md
└── evidencias/
```

[SPEC.md](SPEC.md) define qué se evalúa. [PLAN.md](PLAN.md) fija las interfaces y el diseño. [TASKS.md](TASKS.md) registra qué se ha verificado y qué falta.

## Ejecutar el agente en local

Use [Docker Engine para Ubuntu](https://docs.docker.com/engine/install/ubuntu/) con el complemento Compose. En Windows, ejecute estos pasos desde Ubuntu en WSL y mantenga abierta esa terminal mientras use los servicios. Compruebe el daemon con `sudo docker version` y el complemento con `sudo docker compose version`.

1. Desde `Proyecto-Final-Grupo5/`, copie `.env.example` como `.env` si aún no lo tiene. Genere un valor diferente para cada secreto con `openssl rand -hex 24`. Complete `POSTGRES_PASSWORD`, `JALECO_READER_PASSWORD`, `JALECO_MEMORY_PASSWORD` y `N8N_WEBHOOK_KEY`. Si viene de T2, agregue la contraseña de memoria a su archivo actual y conserve los valores que ya usa. El `.env` se queda en su máquina.
2. Valide y levante la pila.

   ```sh
   sudo docker compose config --quiet
   sudo docker compose up -d --build --wait
   sudo docker compose ps
   ```

3. Si usa un volumen existente de T2, aplique la migración de memoria después del arranque. El mismo SQL se ejecuta automáticamente durante la instalación en un volumen vacío.

   ```sh
   sudo docker compose exec -T postgres psql -U postgres -d jaleco -f /docker-entrypoint-initdb.d/02-chat-memory.sql
   ```

4. Abra el editor local de n8n en `http://localhost:5678`. Cree la cuenta de propietario si es una instalación nueva. Importe `n8n/consultar-pedido.json`, vincule su nodo de PostgreSQL a `jaleco_reader` y publique primero ese subworkflow.
5. Importe `n8n/workflow.json`. Si actualiza una instalación de T2, guarde la versión anterior y actualice el workflow principal existente para conservar las rutas. Seleccione el subworkflow publicado en **consultar_pedido**. Asigne la misma credencial **Header Auth** a **Webhook chat** y **Webhook radicación**, con la cabecera `X-Jaleco-Key` y el valor de `N8N_WEBHOOK_KEY`.
6. Asocie **Postgres Chat Memory** a una credencial PostgreSQL con usuario `jaleco_memory` y contraseña `JALECO_MEMORY_PASSWORD`. Las dos credenciales PostgreSQL usan host `postgres`, puerto `5432`, base `jaleco` y SSL deshabilitado para la red local. La credencial de `jaleco_reader` usa `JALECO_READER_PASSWORD`.
7. Cree una credencial **OpenRouter** con su clave en n8n y vincúlela a **OpenRouter Chat Model**. El export fija `nvidia/nemotron-3.5-super-vl:free` con temperatura cero. Guarde y publique el workflow principal. Para cambiar a un modelo de pago, actualice el modelo en ese nodo y repita las pruebas con sesiones nuevas.
8. Abra Streamlit en `http://localhost:8501`. Envíe «Quiero devolver el pedido JS-101 porque cambié de opinión» y luego «¿Qué día lo recibí?». La evidencia de ambos turnos debe mostrar `JS-101` y `2026-11-13`. Pulse **Nueva conversación** y repita la segunda pregunta. Streamlit debe pedir el ID. El panel **Evidencia · respuesta cruda** también muestra `classification.category`.

La carga SQL se ejecuta al inicializar un volumen de PostgreSQL vacío. `sudo docker compose stop` detiene los servicios y conserva sus volúmenes. Para repetir desde cero sin afectar sus datos, cree otro `.env` con secretos nuevos y puertos libres, por ejemplo `N8N_HOST_PORT=15678` y `STREAMLIT_HOST_PORT=18501`. Desde una copia limpia del proyecto ejecute `sudo docker compose -p jaleco-t2-check up -d --build --wait` y repita la configuración de n8n en el nuevo puerto.

Para trabajar únicamente en la interfaz, instale `app/requirements.txt` en un entorno virtual y ejecute `python -m streamlit run app/app.py` desde esta carpeta. En ese caso use `app/.env.example` como plantilla y ajuste `app/.env` con `N8N_BASE_URL=http://localhost:5678` y la clave del webhook local. Con Compose, la aplicación recibe la URL interna y la clave desde su servicio.

## Verificar T3

Desde la carpeta del proyecto, use Node.js 22 o posterior para ejecutar las comprobaciones del contrato. El primer comando verifica localmente la resolución de IDs y la construcción de la respuesta. El segundo añade nueve pruebas de desarrollo contra el webhook publicado y consume llamadas del modelo configurado.

```sh
node --test n8n/tests/t3-contract.test.cjs
JALECO_T3_URL=http://127.0.0.1:5678/webhook/jaleco-chat node --env-file=.env --test n8n/tests/t3-contract.test.cjs
```

Use los mismos casos al cambiar de modelo. La prueba genera sesiones nuevas para cada corrida y los ejemplos de desarrollo son independientes del corpus reservado para T6.

## Demostración prevista

Describir un reclamo, completar el pedido en un segundo turno y comprobar que una sesión nueva requiere identificarlo de nuevo. Mostrar la evidencia del pedido y la evaluación del plazo, intentar radicar sin marcar la casilla y confirmar. Verificar el registro y descargar su constancia.

El [material de las Clases 10 y 11](https://github.com/UN-GCPDS/ProcesamientoLenguajeNatural) explica el patrón de referencia. Las [evidencias T0](evidencias/) corresponden al arranque del entorno del curso. La [presentación inicial](Presentacion.pdf) distingue ese avance de la evaluación pendiente.

Para regenerar la presentación desde esta carpeta con LaTeX instalado, ejecute `pdflatex Presentacion.tex`.
