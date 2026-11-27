# T3 · Agente, memoria y consulta

Verificación local del 27 de noviembre de 2026 en `grupo5/t3-agent-sessions`, con n8n 2.49.6, PostgreSQL 17.12 y Streamlit 1.67.0. La pila de prueba se creó con volúmenes vacíos. Para las pruebas integradas, un proveedor HTTP simulado respondió al nodo OpenRouter configurado con `nvidia/nemotron-3.5-super-vl:free` y temperatura 0. n8n, PostgreSQL y el navegador se ejecutaron realmente.

## Resultados observados

| Prueba | Resultado |
| --- | --- |
| Sesión A, «Quiero devolver el pedido JS-101 porque cambié de opinión» | `retracto`. Ejecución 29 y subejecución 30 de `consultar_pedido`. La evidencia devolvió `JS-101` y `2026-11-13`. |
| Sesión A, «¿Qué día lo recibí?» | Recuperó el ID del mismo historial y volvió a consultar PostgreSQL. Ejecuciones 31 y 32. |
| Sesión B, «¿Qué día lo recibí?» | Solicitó el ID, devolvió `sin_clasificar` y dejó la evidencia vacía. La ejecución 33 carece de subejecución de consulta. |
| Streamlit real en Edge | Se repitieron A/A/B desde la interfaz y el botón **Nueva conversación**. Los paneles JSON correspondieron a las ejecuciones 61, 63 y 65. |
| Clasificación y validación | Se verificó el transporte de las cuatro etiquetas y dos casos ambiguos con respuestas simuladas. Un valor fuera del catálogo se convirtió en `sin_clasificar`. |
| Límites de lectura | `JS-999` pidió corregir el ID. Dos IDs pidieron aclarar y el ID explícito más reciente prevaleció. Una invocación simulada sin candidato no produjo evidencia y el subworkflow tomó la salida bloqueada. |
| Migración y persistencia | La migración se aplicó dos veces al volumen de T2 y conservó los cuatro pedidos. El rol de memoria tiene permiso de creación en su esquema y carece de acceso al esquema de negocio. El lector carece de acceso al esquema de memoria. Tras reiniciar n8n en la pila de prueba, un seguimiento recuperó `JS-102` en las ejecuciones 59 y 60. |
| Errores | Una cuota simulada devolvió `503 AGENT_UNAVAILABLE`, una credencial de lectura incorrecta devolvió `503 DATA_SOURCE_UNAVAILABLE` y PostgreSQL detenido devolvió `503 MEMORY_UNAVAILABLE`. Las pruebas conservaron `400 INVALID_INPUT`, `403` de Header Auth y la validación de radicación de T2. |

## JSON público observado

La suite versionada completó cinco pruebas de contrato y nueve casos de desarrollo contra el webhook de la pila simulada.

Sesión A, turno inicial.

```json
{"output":"El pedido JS-101 corresponde a Balón de entrenamiento y se entregó el 2026-11-13. Identifiqué el motivo como retracto.","evidence":[{"source":"pedidos","recordId":"JS-101","data":{"orderId":"JS-101","sku":"BAL-01","productName":"Balón de entrenamiento","channel":"online","deliveredOn":"2026-11-13","warrantyMonths":12,"requiresSerial":false}}],"draft":null,"classification":{"category":"retracto"}}
```

Sesión A, seguimiento.

```json
{"output":"El pedido JS-101 corresponde a Balón de entrenamiento y se entregó el 2026-11-13. Identifiqué el motivo como retracto.","evidence":[{"source":"pedidos","recordId":"JS-101","data":{"orderId":"JS-101","sku":"BAL-01","productName":"Balón de entrenamiento","channel":"online","deliveredOn":"2026-11-13","warrantyMonths":12,"requiresSerial":false}}],"draft":null,"classification":{"category":"retracto"}}
```

Sesión B, seguimiento sin contexto.

```json
{"output":"¿Cuál es el número de tu pedido? Por ejemplo, JS-101.","evidence":[],"draft":null,"classification":{"category":"sin_clasificar"}}
```

La suite versionada usa casos de desarrollo. El corpus reservado y la medición de macro-F1 corresponden a T6. Para cerrar T3 queda ejecutar la suite y los tres turnos desde Streamlit contra Nemotron en OpenRouter con una credencial real.
