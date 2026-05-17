import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "lyth-mcp-smoke-"));
process.env.LYTH_MCP_CONNECTOR_STORE = join(temp, "connectors.json");
process.env.LYTH_MCP_CONNECTOR_KEY = join(temp, "connector.key");
process.env.LYTH_MCP_MERCHANT_POLICY_STORE = join(temp, "merchant_policies.json");
process.env.LYTH_MCP_BOOKING_STORE = join(temp, "bookings.json");
process.env.LYTH_MCP_ORDER_STORE = join(temp, "orders.json");
process.env.LYTH_MCP_INVOICE_STORE = join(temp, "invoices.json");

const connectors = await import("../dist/connectors.js");
const merchant = await import("../dist/merchant_policy.js");
const bookings = await import("../dist/bookings.js");
const orders = await import("../dist/orders.js");
const invoices = await import("../dist/invoices.js");
const bridges = await import("../dist/bridges.js");
const assets = await import("../dist/assets.js");
const runbooks = await import("../dist/runbooks.js");
const commerceSafety = await import("../dist/commerce_safety.js");
const riskRenderer = await import("../dist/risk_renderer.js");
const errorExplain = await import("../dist/error_explain.js");
const clusters = await import("../dist/clusters.js");
const delegation = await import("../dist/delegation.js");
const nodes = await import("../dist/nodes.js");
const walletSafety = await import("../dist/wallet_safety.js");
const security = await import("../dist/security.js");
const readiness = await import("../dist/readiness.js");
const demoConnectors = await import("../dist/demo_connectors.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const connector = await connectors.upsertConnector({
  id: "pizza-demo-webhook",
  vendorId: "pizza-demo",
  endpoint: "https://vendor.example/orders",
  authMode: "hmac_sha256",
  secret: "test-secret",
});
const listedConnectors = await connectors.listConnectors({ vendorId: "pizza-demo" });
const headers = await connectors.buildConnectorHeaders(connector, JSON.stringify({ test: true }));
assert(listedConnectors.length === 1, "expected connector list to include one connector");
assert(listedConnectors[0].auth.secretConfigured === true, "expected connector secret to be redacted but configured");
assert(typeof headers["X-Lyth-Signature"] === "string", "expected hmac signature header");

const vendor = { id: "pizza-demo", displayName: "Pizza Demo", category: "food", fulfillment: { type: "demo" } };
await merchant.upsertMerchantPolicy({
  vendorId: "pizza-demo",
  allowlisted: true,
  maxOrderAmount: "15",
  allowedAssets: ["LYTH"],
  allowedCategories: ["food"],
});
const policy = await merchant.getMerchantPolicy("pizza-demo");
const allowedRisk = merchant.evaluateMerchantPolicy({ vendor, policy, amount: "12", asset: "LYTH" });
const blockedRisk = merchant.evaluateMerchantPolicy({ vendor, policy, amount: "20", asset: "LYTH" });
assert(allowedRisk.ok === true, "expected merchant policy to allow 12 LYTH");
assert(blockedRisk.ok === false, "expected merchant policy to block 20 LYTH");

const order = await orders.createOrder({
  network: "testnet-69420",
  chainId: 69420,
  vendorId: "pizza-demo",
  vendorDisplayName: "Pizza Demo",
  vendorAddress: "0x1111111111111111111111111111111111111111",
  itemName: "Margherita",
  quantity: 1,
  amount: "9",
  asset: "LYTH",
  registryHash: "sha256:test",
  quote: {},
});
await orders.updateOrder(order.id, {
  status: "fulfillment_requested",
  fulfillment: {
    adapter: "webhook",
    confirmation: "accepted",
    requestedAt: new Date().toISOString(),
    connectorId: connector.id,
    responseStatus: 202,
    responseHash: "sha256:test",
  },
}, { type: "fulfillment_webhook_sent" });
assert((await orders.getOrder(order.id)).status === "fulfillment_requested", "expected order webhook status");

const booking = await bookings.createBooking({
  network: "testnet-69420",
  chainId: 69420,
  vendorId: "pizza-demo",
  service: "Pizza delivery",
  amount: "9",
  asset: "LYTH",
  registryHash: "sha256:test",
});
await bookings.updateBooking(booking.id, { status: "provider_requested" }, { type: "booking_webhook_sent" });
assert((await bookings.getBooking(booking.id)).status === "provider_requested", "expected booking provider request status");

const invoice = await invoices.createInvoice({
  type: "funding_request",
  network: "testnet-69420",
  chainId: 69420,
  recipient: "0x1111111111111111111111111111111111111111",
  amount: "10",
  asset: "LYTH",
  purpose: "Smoke test funding",
});
await invoices.updateInvoice(invoice.id, { status: "paid", txHash: "0xabc" }, "paid", { txHash: "0xabc" });
assert((await invoices.getInvoice(invoice.id)).status === "paid", "expected paid invoice");

const bridgeRegistry = await bridges.loadBridgeRegistry("./bridge_routes.example.json");
const bridgeRoute = bridges.selectBridgeRoute(bridgeRegistry.registry, {
  asset: "USDC",
  sourceChain: "Ethereum",
  destinationChain: "Monolythium",
});
assert(bridgeRoute?.id === "eth-usdc-to-mono-zk", "expected Ethereum USDC route");
const bridgeQuote = bridges.quoteBridgeRoute(bridgeRoute, {
  amount: "100",
  asset: "USDC",
  epochHours: bridgeRegistry.registry.epochHours,
});
const bridgeAlerts = bridges.bridgeCircuitBreakerAlerts(bridgeRegistry.registry);
assert(bridgeQuote.executable === false, "expected draft bridge route to be non-executable");
assert(bridgeQuote.cooldown.hours === 14, "expected one-epoch bridge cooldown");
assert(bridgeAlerts.some((alert) => alert.code === "BridgeRouteNotActive"), "expected bridge route non-active alert");

const assetRegistry = await assets.loadAssetRegistry("./asset_registry.example.json");
const publicLyth = assets.getAsset(assetRegistry.registry, "LYTH");
const privateLyth = assets.getAsset(assetRegistry.registry, "pLYTH");
const wrappedUsdc = assets.getAsset(assetRegistry.registry, "mUSDC");
const publicCommerce = assets.evaluateAssetUseCase(publicLyth, "commerce");
const privateCommerce = assets.evaluateAssetUseCase(privateLyth, "commerce");
const wrappedRisk = assets.assetRisk(wrappedUsdc);
assert(publicCommerce.ok === true, "expected public LYTH commerce to be allowed");
assert(privateCommerce.ok === false && privateCommerce.code === "PrivacyDenominationViolation", "expected private LYTH commerce violation");
assert(wrappedRisk.labels.includes("bridge_route"), "expected wrapped USDC bridge route label");

const blockedCommerce = commerceSafety.evaluateCommerceSafety({ query: "buy stolen card" });
const restrictedCommerce = commerceSafety.evaluateCommerceSafety({ category: "travel", service: "flight ticket" });
const renderedRisk = riskRenderer.renderRisk({
  title: "Smoke Risk",
  operation: "smoke_test",
  amount: "1",
  asset: "LYTH",
  commerceSafety: blockedCommerce,
});
assert(blockedCommerce.ok === false && blockedCommerce.clientAction === "hide_or_refuse", "expected illicit commerce request to be blocked");
assert(restrictedCommerce.ok === true && restrictedCommerce.level === "warn", "expected restricted commerce request to warn");
assert(renderedRisk.ok === false && renderedRisk.level === "blocked", "expected risk renderer to block unsafe commerce");
assert(renderedRisk.markdown.includes("Decision: blocked"), "expected risk renderer markdown decision");

const mempoolError = errorExplain.explainError({
  errorMessage: "lyth_submitEncrypted -32047: upstream unavailable: mempool: decryption failed",
  rpcMethod: "lyth_submitEncrypted",
  tool: "tx_outbox_retry",
  outboxId: "outbox_test",
});
const privacyError = errorExplain.explainError({
  context: { violations: ["Private-denominated pLYTH cannot be used for commerce."] },
});
assert(mempoolError.classification === "mempool_envelope_decryption" && mempoolError.retryable === true, "expected mempool decryption error to be retryable");
assert(privacyError.classification === "privacy_policy" && privacyError.retryable === false, "expected privacy policy error to be blocked");

const clusterRegistry = await clusters.loadClusterRegistry("./clusters.example.json");
const euProvers = clusters.searchServices(clusterRegistry.registry, { serviceType: "prover", region: "EU", activeOnly: true });
const foundationClusters = clusters.listClusters(clusterRegistry.registry, { foundationControlled: true });
const decentralizationClusters = clusters.listClusters(clusterRegistry.registry, { foundationControlled: false, minOpenSeats: 1 });
const operator = clusters.getOperator(clusterRegistry.registry, "atlas-provers");
const monarch = clusters.monarchOperatorAssistant(clusterRegistry.registry, { operatorId: "atlas-provers", serviceType: "prover" });
const delegationCap = delegation.explainDelegationCaps({
  phase: "growth",
  totalDelegatedStake: "1000",
  currentClusterStake: "140",
  intendedAdditionalStake: "40",
  selectedClusterCount: 5,
  overCapEpochs: 3,
});
const stakeStatus = delegation.stakeStatus(clusterRegistry.registry, {
  phase: "growth",
  positions: [
    { clusterId: "mono-eu-1", amount: "180" },
    { clusterId: "mono-nl-community-1", amount: "300" },
    { clusterId: "mono-us-west-1", amount: "120" },
  ],
});
const delegateDraft = delegation.delegateDraft(clusterRegistry.registry, {
  clusterId: "mono-nl-community-1",
  amount: "50",
  mode: "max_decentralization",
  positions: stakeStatus.positions.map((entry) => entry.position),
});
const rebalanceDraft = delegation.rebalanceDraft(clusterRegistry.registry, {
  mode: "max_decentralization",
  positions: stakeStatus.positions.map((entry) => entry.position),
  targetClusterCount: 3,
});
const undelegateDraft = delegation.undelegateDraft(clusterRegistry.registry, {
  clusterId: "mono-eu-1",
  amount: "40",
  positions: stakeStatus.positions.map((entry) => entry.position),
});
const autovote = delegation.autovoteSimulate(clusterRegistry.registry, {
  mode: "max_decentralization",
  positions: stakeStatus.positions.map((entry) => entry.position),
  candidateLimit: 3,
});
const nodeRegistry = await nodes.loadNodeRegistry("./nodes.example.json");
const proverNode = nodes.getNode(nodeRegistry.registry, "nl1-prover-01");
const rpcNode = nodes.getNode(nodeRegistry.registry, "nl1-rpc-01");
const attestation = nodes.nodeAttestation(proverNode);
const rpcAttestation = nodes.nodeAttestation(rpcNode);
const pcr = nodes.explainPcr(rpcNode, "7");
const diversity = nodes.nodeDiversityScore(nodeRegistry.registry, { clusterId: "mono-nl-community-1" });
const hosting = nodes.nodeHostingClass(proverNode);
assert(euProvers.some((entry) => entry.clusterId === "mono-nl-community-1"), "expected EU prover service search to include NL community cluster");
assert(foundationClusters.some((cluster) => cluster.id === "mono-eu-1"), "expected foundation cluster flag search");
assert(decentralizationClusters[0].id === "mono-nl-community-1", "expected NL community cluster to lead decentralization candidates");
assert(clusters.operatorStatus(clusterRegistry.registry, operator).openSeats > 0, "expected atlas-provers to have open-seat exposure");
assert(monarch.clusters.some((entry) => entry.quorum.configured === "7-of-10"), "expected monarch assistant quorum explanation");
assert(monarch.guardrails.some((entry) => entry.includes("node/operator")), "expected monarch assistant node-ops guardrail");
assert(delegationCap.taper.overCap === true && delegationCap.taper.rewardTaperPercent > 0, "expected delegation cap taper for over-cap cluster");
assert(delegationCap.diversification.ok === false, "expected delegation diversification warning");
assert(stakeStatus.totalDelegatedStake === "600", "expected local stake status total");
assert(delegateDraft.operation === "delegate" && delegateDraft.unsigned === true, "expected unsigned delegate draft");
assert(rebalanceDraft.operations.length === 3, "expected rebalance target operations");
assert(undelegateDraft.operation === "undelegate", "expected undelegate draft");
assert(autovote.rankedCandidates.length === 3, "expected autovote candidate ranking");
assert(attestation.ok === true && attestation.status === "verified", "expected prover node attestation to verify against local profile");
assert(rpcAttestation.ok === false && rpcAttestation.mismatches.some((item) => item.pcr === "7"), "expected RPC node PCR mismatch");
assert(pcr.entries[0].meaning.includes("Secure Boot"), "expected PCR 7 explanation");
assert(diversity.score > 50, "expected NL cluster node diversity score");
assert(hosting.risk === "low", "expected community baremetal hosting to be low risk");

const runbookList = await runbooks.listCanonicalRunbooks("./runbooks");
assert(runbookList.length >= 9, "expected bundled canonical runbooks");

const walletFixture = {
  name: "pizza-agent",
  address: "0x71550000000000000000000000000000000029bd",
  publicKey: "0xabc",
  algorithm: "PQM1-MLDSA65",
  keyProtection: "local_machine_key",
  createdAt: new Date().toISOString(),
  lowValue: {
    enabled: true,
    asset: "LYTH",
    maxAmount: "10",
    dailyLimit: "50",
    accounting: {
      remainingToday: "48",
      reserved: "0.2",
      submitted: "0",
    },
    configuredAt: new Date().toISOString(),
  },
  agent: {
    purpose: "Small food-ordering demos on testnet",
    network: "testnet-69420",
    allowedCategories: ["food"],
    fallbackApproval: "wallet_handoff",
    paused: false,
    updatedAt: new Date().toISOString(),
  },
};
const safetyProfile = walletSafety.accountSafetyProfiles({
  wallets: [walletFixture],
  outboxEntries: [],
  receipts: [],
});
const allowedHotSpend = walletSafety.simulateHotWalletPolicy({
  wallet: walletFixture,
  amount: "5",
  category: "food",
});
const blockedHotSpend = walletSafety.simulateHotWalletPolicy({
  wallet: walletFixture,
  amount: "12",
  category: "food",
});
const threshold = walletSafety.explainWalletThresholds({
  amount: "5",
  lowValueCap: "10",
  passkeyCap: "100",
  walletHasLowValuePolicy: true,
});
assert(safetyProfile.highestRisk === "medium", "expected local hot wallet profile to be medium risk");
assert(allowedHotSpend.ok === true, "expected hot-wallet policy to allow 5 LYTH food spend");
assert(blockedHotSpend.ok === false, "expected hot-wallet policy to block amount above cap");
assert(threshold.selectedTier === "agent_hot_wallet", "expected threshold explanation to select agent hot wallet");

const securityContext = {
  network: "testnet-69420",
  chainId: 69420,
  submitEnabled: false,
  rpcHealth: {
    selectedRead: "http://127.0.0.1:8545",
    selectedWrite: null,
    endpoints: [{ endpoint: "http://127.0.0.1:8545", ok: true, score: 60, writeReady: false }],
  },
  bridgeRegistry: bridgeRegistry.registry,
  clusterRegistry: clusterRegistry.registry,
  nodeRegistry: nodeRegistry.registry,
  wallets: [walletFixture],
  outboxEntries: [],
  receipts: [],
  runbookCount: runbookList.length,
};
const securityDashboard = security.securityStatus(securityContext);
const emergencyWatch = security.emergencyStateWatch(securityContext);
const blastRadius = security.bridgeBlastRadiusMonitor(securityContext);
const recovery = security.recoveryStatus(securityContext, "pizza-agent");
const recoveryDraft = security.recoveryRunbookDraft({ kind: "pause_agent", walletName: "pizza-agent" });
const auditGates = security.auditResearchGateDashboard(securityContext);
assert(securityDashboard.components.some((component) => component.id === "mempool_rpc"), "expected mempool security component");
assert(emergencyWatch.events.some((event) => event.code === "BridgeRoutePaused"), "expected emergency bridge pause event");
assert(blastRadius.severity === "critical", "expected critical bridge blast radius from paused trusted route");
assert(recovery.wallets[0].availableRunbooks.length >= 4, "expected recovery runbooks");
assert(recoveryDraft.requiredTool === "agent_wallet_pause", "expected pause recovery runbook draft");
assert(auditGates.gates.some((gate) => gate.id === "riscv_vm"), "expected RISC-V audit gate");

const readinessDashboard = readiness.readinessCheck({
  toolNames: [
    "contract_path_guidance",
    "asset_registry_info",
    "asset_search",
    "asset_risk_label",
    "vendor_search",
    "order_create",
    "booking_request_create",
    "funding_request_create",
    "provider_onboarding_draft",
    "bridge_routes",
    "bridge_quote",
    "bridge_circuit_breaker_watch",
    "liquidity_onboarding",
    "agent_wallet_create",
    "wallet_preflight_transfer",
    "wallet_build_transfer",
    "wallet_safety_profile",
    "hot_wallet_policy_simulate",
    "runbook_list",
    "runbook_get",
    "validate_runbook",
    "prepare_wallet_request",
    "security_status",
    "emergency_state_watch",
    "bridge_blast_radius",
    "recovery_status",
  ],
  runbookCount: runbookList.length,
  vendorCount: 5,
  bridgeRouteCount: bridgeRegistry.registry.routes.length,
  activeBridgeRouteCount: bridgeRegistry.registry.routes.filter((route) => route.status === "active").length,
  assetCount: assetRegistry.registry.assets.length,
  walletCount: 1,
  docsUpdated: true,
  testsUpdated: true,
});
assert(readinessDashboard.gates.length === 9, "expected all readiness gates");
assert(readiness.readinessCheck({
  toolNames: [],
  runbookCount: 0,
  vendorCount: 0,
  bridgeRouteCount: 0,
  activeBridgeRouteCount: 0,
  assetCount: 0,
  walletCount: 0,
}, "bridge").gates[0].id === "bridge", "expected bridge readiness gate filter");

const connectorTemplates = demoConnectors.listDemoConnectorTemplates();
const coinsbeeTemplate = demoConnectors.getDemoConnectorTemplate("coinsbee-giftcards-demo");
const foodDraft = demoConnectors.demoConnectorDraft({ templateId: "food-delivery-demo", vendorId: "pizza-demo" });
assert(connectorTemplates.length >= 7, "expected demo connector templates");
assert(coinsbeeTemplate.status === "todo_demo_stub", "expected Coinsbee template to be marked TODO/demo");
assert(foodDraft.connectorSetDraft.enabled === false, "expected demo connector draft to be disabled by default");

const failureCases = JSON.parse(await readFile(new URL("../fixtures/failure_cases.json", import.meta.url), "utf8"));
for (const failureCase of failureCases) {
  const explained = errorExplain.explainError(failureCase.input);
  assert(explained.classification === failureCase.expected.classification, `expected failure classification for ${failureCase.name}`);
  assert(explained.retryable === failureCase.expected.retryable, `expected retryable flag for ${failureCase.name}`);
}

const mockRpc = await startMockRpc();
try {
  const failedSubmit = await mockRpc.call("lyth_submitEncrypted", ["0xdeadbeef"]);
  assert(failedSubmit.error?.code === -32047, "expected mocked encrypted submit failure");
  const explained = errorExplain.explainError({
    errorMessage: `${failedSubmit.error.message}`,
    code: failedSubmit.error.code,
    rpcMethod: "lyth_submitEncrypted",
  });
  assert(explained.classification === "mempool_envelope_decryption", "expected mocked RPC failure to classify as mempool decryption");
} finally {
  await mockRpc.close();
}

console.log(JSON.stringify({
  ok: true,
  temp,
  connector: connector.id,
  order: order.id,
  booking: booking.id,
  invoice: invoice.id,
  bridgeRoute: bridgeRoute.id,
  bridgeAlerts: bridgeAlerts.length,
  assets: assetRegistry.registry.assets.length,
  blockedCommerce: blockedCommerce.level,
  explainedError: mempoolError.classification,
  clusters: clusterRegistry.registry.clusters.length,
  euProvers: euProvers.length,
  monarchClusters: monarch.clusters.length,
  delegationTaper: delegationCap.taper.rewardTaperPercent,
  autovoteCandidates: autovote.rankedCandidates.length,
  nodes: nodeRegistry.registry.nodes.length,
  nodeDiversity: diversity.score,
  security: securityDashboard.severity,
  readiness: readinessDashboard.completionPercent,
  demoConnectorTemplates: connectorTemplates.length,
  runbooks: runbookList.length,
}, null, 2));

async function startMockRpc() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const request = JSON.parse(body || "{}");
      const response = request.method === "lyth_submitEncrypted"
        ? {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32047,
              message: "upstream unavailable: mempool: decryption failed",
            },
          }
        : {
            jsonrpc: "2.0",
            id: request.id,
            result: "0x10f2c",
          };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    async call(method, params = []) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return res.json();
    },
    close() {
      return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    },
  };
}
