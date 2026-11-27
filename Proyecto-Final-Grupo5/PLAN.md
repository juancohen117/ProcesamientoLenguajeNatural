# PLAN · Architecture and contracts

## Architecture

Streamlit → internal n8n HTTP webhooks → agent, rules, and persistence → PostgreSQL. Streamlit, n8n, and PostgreSQL share the same deployment environment. The browser connects to Streamlit through its published port. Streamlit calls `http://n8n:5678` over the Compose network, and n8n connects to PostgreSQL using its service name.

| Component | Responsibility |
| --- | --- |
| Streamlit | Receive messages, validate format and length, keep visible history for each session, display the received JSON, present the confirmation form, and generate the PDF receipt. If attachments are enabled, the application validates them and extracts their contents. |
| n8n · Chat | Validate the contract, classify the request with the AI Agent at temperature 0, and look up the authorized order. T4 adds rule evaluation and T5 adds filing. |
| n8n · Case filing | Validate confirmation, session ownership, and draft expiration. Create the case idempotently and return the stored record. |
| PostgreSQL | Store orders, versioned policies, the test calendar, memory, drafts, and cases. A unique constraint on `casos.draft_id` supports idempotency. |

PostgreSQL stores Jaleco data. It supports scripted seeding and can enforce consistency and uniqueness within a transaction when case filing is added. n8n uses SQLite in its own persistent volume for workflow configuration. T2 seeds orders, policies, and a holiday calendar on an empty PostgreSQL volume. The n8n credential has read-only access to those tables. The Google Sheets credentials and the course workflow test document the T0 setup.

The contract retains `sessionId`, `chatInput`, and `output` from the course example. The Respond to Webhook node returns a JSON object with a stable schema. The interface uses that object and records the response body as evidence for the turn.

T2 uses a single Compose network with both browser-facing ports bound to loopback. Streamlit reaches n8n by service name. Local setup requires attaching a Header Auth credential to both webhook nodes and a PostgreSQL credential to the lookup node before publishing.

T3 keeps the T2 reader credential on the lookup subworkflow. A separate `jaleco_memory` credential can write only in its own schema. The agent and Chat Memory Manager share a Postgres Chat Memory node with key `jaleco:<sessionId>` and a six-interaction agent window. The context resolver reads only the six most recent human turns for identifier resolution. An explicit ID overrides history. Multiple IDs in the current turn, or in the latest relevant human turn, require clarification. The migration runs on both new and existing volumes.

## Tools and design decisions

| Operation | When to use it and required parameters | Restrictions |
| --- | --- | --- |
| `consultar_pedido` | With a single order ID resolved for the current turn, retrieve one row using the T2 parameterized query in an internal subworkflow. | Bind `orderId` from the validated context. The tool skips SQL when there is no authorized candidate. Use synthetic data and authorized fields only. Reject bulk order listings, writes, and SQL supplied by the model. |
| `consultar_politica` | Given the normalized category and effective-date context, retrieve the applicable policy. | Read-only. Do not invent exceptions or substitute text from the chat for the policy rule. |
| `evaluar_solicitud` | Given the retrieved order and policy, calculate the outcome using the calendar, cutoff date, and evidence fields. | Use deterministic code and set test dates outside the chat. The structured result determines the decision returned to the user. |
| `radicar_caso` | Call through the write webhook with `sessionId`, `draftId`, and explicit boolean confirmation. | Reject case creation through free-form chat. Do not accept draft fields modified by the client. |

In T3, the agent classifies the request and decides whether a follow-up refers to the historical candidate. An explicit current ID requires a tool call. n8n validates the single-key category object and uses `sin_clasificar` for invalid values. It builds the Spanish response and the evidence from the tool observation for the authorized ID. Intermediate steps stay internal. T4 will determine policy outcomes from structured source data. T5 will store immutable, expiring drafts and will use the draft ID as an idempotency key while enforcing session ownership.

The OpenRouter node is the single place to set the model and its generation parameters. T3 pins Nemotron with temperature 0, a 1,024-token output limit, an 18-second provider timeout, and zero automatic retries. The agent runs up to three iterations. Compare a future model with the same contract tests and fresh sessions.

## HTTP contract

Both endpoints accept `Content-Type: application/json`. `sessionId` is a UUID that stays the same throughout the conversation. Streamlit generates another UUID for each new session. The Streamlit server sends the Header Auth key as `X-Jaleco-Key`. Both published webhooks require this credential.

### Conversation

`POST /webhook/jaleco-chat`

```json
{"sessionId":"9e765fc1-5868-4413-a916-6dc01cda975a","chatInput":"Mi pedido JS-104 llegó incompleto"}
```

`chatInput` accepts 1–2000 characters after trimming whitespace. A successful request returns HTTP `200` with the following body.

```json
{
  "output": "El pedido JS-104 corresponde a Kit de bandas elásticas y se entregó el 2026-11-17. Identifiqué el motivo como pedido incompleto.",
  "evidence": [{
    "source": "pedidos",
    "recordId": "JS-104",
    "data": {
      "orderId": "JS-104",
      "sku": "KIT-04",
      "productName": "Kit de bandas elásticas",
      "channel": "online",
      "deliveredOn": "2026-11-17",
      "warrantyMonths": 12,
      "requiresSerial": false
    }
  }],
  "draft": null,
  "classification": {"category": "pedido_incompleto"}
}
```

Each item in `evidence` includes `source` and `recordId` and may include the fields used under `data`. When a draft is available, `draft` contains `draftId`, `orderId`, `category`, and `decision`. Expected outcomes are `elegible_preliminar`, `fuera_de_plazo_preliminar`, `evidencia_pendiente`, and `revision_humana`.

Successful T3 responses include `classification.category` with one of the five values in the SPEC. A turn without an unambiguous reference receives a clarification with `evidence: []`. An unknown ID receives a correction prompt with the same shape. `draft` is always `null` in T3.

### Case filing

`POST /webhook/jaleco-radicar`

```json
{"sessionId":"9e765fc1-5868-4413-a916-6dc01cda975a","draftId":"630a57b4-dd5a-491b-901b-67124ea2c474","confirmed":true}
```

The endpoint returns `201` when it creates a case and `200` when it retrieves an existing case for the same draft. Both responses include `output` and `case`. The `case` object contains `caseId`, `orderId`, `category`, `decision`, and an ISO 8601 `createdAt` timestamp.

Through T3, the endpoint validates the request and returns `503 PERSISTENCE_UNAVAILABLE` for a valid confirmation. Case creation and retries are implemented in T5.

### Errors

Application error responses include Spanish text in `output` and a diagnostic `error.code`. They use `400` for invalid input or missing explicit confirmation, `404` for an inaccessible or expired unfiled draft once filing is available, and `503` for unavailable dependencies. T3 distinguishes `MEMORY_UNAVAILABLE`, `AGENT_UNAVAILABLE`, and `DATA_SOURCE_UNAVAILABLE`. A missing required tool call is an agent failure. An invalid observation from the lookup tool is a source failure. Native n8n Header Auth returns `403` for a missing or wrong key before workflow execution and may return plain text. The client handles responses outside the application schema.

## Risks and checks

- Date interpretation. Use `America/Bogota`, version the calendar, and test inclusive boundaries. Record the dates observed in the evidence.
- Uncertain classification or ambiguous conditions. Ask for clarification, abstain, or refer the case for human review. Classification alone cannot authorize an action.
- Provider or database failure. Log the failure and return an error in Spanish. A filing retry reuses the same `draftId`.
- Changing dependencies. Pin the verified n8n version and record the model and rule version before the rehearsal. Store secrets in n8n credentials or local environment variables.
- Information exposure. Use synthetic data and omit credentials, personal data, and internal model text from exported evidence.
