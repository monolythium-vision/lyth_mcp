# Claude And Codex Examples

These examples assume the MCP server is installed as `lyth-mcp` and connected to Claude Code, Codex, or another MCP-capable client.

## Check The MCP

Ask:

```text
check lyth_mcp
```

Useful tools:

- `mcp_self_check`
- `mcp_dashboard`
- `readiness_check`
- `security_status`

## Create A Small Agent Wallet

Ask:

```text
create an agent wallet named pizza-agent for small food-ordering demos, cap it at 10 LYTH per tx and 50 LYTH per day
```

Tool shape:

```json
{
  "name": "pizza-agent",
  "purpose": "Small food-ordering demos on testnet",
  "confirm": "CREATE_AGENT_WALLET",
  "maxBalance": "25",
  "lowValueMaxAmount": "10",
  "lowValueDailyLimit": "50",
  "allowedCategories": ["food"],
  "fallbackApproval": "wallet_handoff"
}
```

## Simulate A Small Spend

Ask:

```text
would pizza-agent be allowed to spend 9 LYTH on pizza right now?
```

Tool:

```json
{
  "walletName": "pizza-agent",
  "amount": "9",
  "asset": "LYTH",
  "category": "food"
}
```

Use `wallet_threshold_explain` when deciding between hot wallet, passkey/wallet handoff, or full-key approval.

## Demo Pizza Flow

Ask:

```text
I'm hungry. Find the demo pizza vendor and prepare an order for a Diavola.
```

Expected flow:

1. `vendor_search`
2. `order_quote`
3. `merchant_risk_check`
4. `order_create`
5. `order_pay`
6. `wallet_build_transfer` only if the user approved and the wallet policy allows it

The bundled pizza vendor is fake. No real food is delivered.

## Bridge Risk

Ask:

```text
can I bridge 100 USDC into Mono, and what is the cooldown?
```

Expected tools:

- `bridge_quote`
- `bridge_cooldown_matrix`
- `bridge_circuit_breaker_watch`
- `bridge_blast_radius`

Draft routes must remain non-executable until core/indexer bridge support exists.

## Recovery

Ask:

```text
show recovery status for pizza-agent and draft a pause runbook
```

Expected tools:

- `recovery_status`
- `recovery_runbook_draft`
- `agent_wallet_pause`

Pausing disables future low-value signing. It cannot invalidate signed payloads already copied elsewhere.

