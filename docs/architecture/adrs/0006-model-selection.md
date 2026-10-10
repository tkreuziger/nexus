# ADR-6: Model selection is per session, with a server default

`INPUT.md` §4.2 has a user create a session "supplying a name", but says nothing about which model the conversation runs.

## Context

Pi Durable requires a model to generate: `root(ctx, { agent: { model: { provider, modelId } } })`. Without one, no run can start. The harness resolves the provider against a `Models` collection (`builtinModels` registers 42 built-in providers).

## Decision

`POST /projects/:id/sessions` accepts an optional `model: { provider, modelId }`. `NEXUS_DEFAULT_MODEL` (`provider:modelId`) supplies the fallback. A session with neither is rejected with a clear error rather than failing later inside the harness.

## Consequences

- The gap in the specification is closed explicitly instead of being discovered at first prompt.
- A deployment can pin one model for all sessions without a client change.
- The session record stores the resolved model so a restart reuses the same one.
- Model choice is per session, not per project, so two sessions in one project can use different models.

## Related

- `docs/plans/pi-session-server.md` — ADR-6
- `docs/architecture/pi-durable-api.md` — `Harness.open` and `root()`
