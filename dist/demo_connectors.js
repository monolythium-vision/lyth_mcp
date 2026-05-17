const TEMPLATES = [
    {
        id: "stripe-checkout-demo",
        kind: "stripe",
        displayName: "Stripe Checkout Demo Stub",
        category: "payments",
        status: "todo_demo_stub",
        vendorIdSuggestion: "stripe-checkout-demo",
        authModes: ["bearer", "hmac_sha256"],
        requiredSecrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        requiredFields: ["lineItems", "customerEmail", "successUrl", "cancelUrl"],
        exampleEndpoint: "https://api.stripe.com/v1/checkout/sessions",
        payloadShape: {
            mode: "payment",
            lineItems: "TODO(demo): map order catalog item to Stripe line_items",
            metadata: {
                monoNetwork: "testnet-69420",
                runbookId: "<runbook-id>",
                orderId: "<local-order-id>",
            },
        },
        safetyNotes: [
            "This is a TODO/demo stub; do not send real customer payments until terms, refunds, taxes, and webhook verification are implemented.",
            "Stripe settlement is off-chain. A Mono receipt should link to a vendor invoice, not pretend the card payment settled on-chain.",
        ],
        todos: [
            "TODO(stripe): create a dedicated connector that uses Stripe SDK/API idempotency keys.",
            "TODO(stripe): verify Stripe webhook signatures before marking local invoices paid.",
            "TODO(stripe): map refunds/disputes into MCP receipts.",
        ],
    },
    {
        id: "coinsbee-giftcards-demo",
        kind: "coinsbee",
        displayName: "Coinsbee Gift Card Demo Stub",
        category: "gift_cards",
        status: "todo_demo_stub",
        vendorIdSuggestion: "coinsbee-giftcards-demo",
        authModes: ["header", "hmac_sha256"],
        requiredSecrets: ["COINSBEE_API_KEY"],
        requiredFields: ["email", "productId", "denomination", "country"],
        exampleEndpoint: "https://api.coinsbee.example/TODO/orders",
        payloadShape: {
            productId: "<catalog-product-id>",
            denomination: "<amount>",
            email: "<recipient-email>",
            reference: "<local-order-id>",
        },
        safetyNotes: [
            "Unofficial TODO/demo stub only. Use official vendor documentation and approval before any real integration.",
            "Gift cards are fraud-sensitive. Keep tighter caps, KYC/AML policy, refund rules, and risk scoring.",
        ],
        todos: [
            "TODO(coinsbee): replace placeholder endpoint with official API endpoint after vendor approval.",
            "TODO(coinsbee): store product catalog, region restrictions, pricing, and code delivery status.",
            "TODO(coinsbee): add compliance/risk gates for high-risk categories and repeat purchases.",
        ],
    },
    {
        id: "travel-booking-demo",
        kind: "travel",
        displayName: "Travel Booking Demo Stub",
        category: "travel",
        status: "todo_demo_stub",
        vendorIdSuggestion: "flight-tickets-demo",
        authModes: ["bearer", "hmac_sha256"],
        requiredSecrets: ["TRAVEL_API_KEY", "TRAVEL_WEBHOOK_SECRET"],
        requiredFields: ["passengerName", "email", "routeId", "travelDate", "passportCountry"],
        exampleEndpoint: "https://travel.example/TODO/bookings",
        payloadShape: {
            routeId: "<route-id>",
            passenger: {
                name: "<passenger-name>",
                email: "<email>",
                passportCountry: "<country>",
            },
            travelDate: "<date>",
            paymentReference: "<mono-receipt-or-escrow-id>",
        },
        safetyNotes: [
            "Travel requires identity, cancellation, sanctions, and refund handling. Demo only until a real provider agreement exists.",
            "Agents should show itinerary, passenger data, price, refund policy, and deadline before approval.",
        ],
        todos: [
            "TODO(travel): integrate provider search and fare hold/expiration semantics.",
            "TODO(travel): verify ticket issuance before marking booking completed.",
            "TODO(travel): support cancellation/refund receipts.",
        ],
    },
    {
        id: "food-delivery-demo",
        kind: "food",
        displayName: "Food Delivery Demo Stub",
        category: "food",
        status: "todo_demo_stub",
        vendorIdSuggestion: "pizza-demo",
        authModes: ["hmac_sha256"],
        requiredSecrets: ["FOOD_VENDOR_WEBHOOK_SECRET"],
        requiredFields: ["deliveryAddress", "phone", "orderNotes", "tipAmount"],
        exampleEndpoint: "https://restaurant.example/TODO/orders",
        payloadShape: {
            items: [{ sku: "<catalog-item-id>", quantity: 1 }],
            delivery: {
                address: "<delivery-address>",
                phone: "<phone>",
                notes: "<order-notes>",
            },
            tipAmount: "<tip>",
            paymentReference: "<mono-tx-hash-or-local-order-id>",
        },
        safetyNotes: [
            "Demo only. Real food orders need vendor acceptance, local delivery availability, tax/tip handling, and cancellation policy.",
            "Keep low-value caps tight and require a human approval before first spend.",
        ],
        todos: [
            "TODO(food): add vendor availability and delivery-zone checks.",
            "TODO(food): map accepted order, preparing, picked up, delivered, cancelled states.",
            "TODO(food): support vendor-signed receipts.",
        ],
    },
    {
        id: "service-provider-demo",
        kind: "service_provider",
        displayName: "Service Provider Demo Stub",
        category: "home_services",
        status: "todo_demo_stub",
        vendorIdSuggestion: "plumber-demo",
        authModes: ["bearer", "hmac_sha256"],
        requiredSecrets: ["SERVICE_PROVIDER_API_KEY", "SERVICE_PROVIDER_WEBHOOK_SECRET"],
        requiredFields: ["serviceAddress", "phone", "issueDescription", "preferredWindow"],
        exampleEndpoint: "https://services.example/TODO/jobs",
        payloadShape: {
            serviceType: "<service>",
            location: "<service-address>",
            issueDescription: "<description>",
            preferredWindow: "<window>",
            escrowReference: "<escrow-id-if-used>",
        },
        safetyNotes: [
            "For real services, prefer escrow or post-completion release instead of direct payment.",
            "Agents should show provider identity, ETA, max spend, cancellation path, and dispute path.",
        ],
        todos: [
            "TODO(service): connect to provider availability and counter-offer flow.",
            "TODO(service): add escrow create/release/dispute integration once core exposes it.",
            "TODO(service): require provider-signed completion evidence before release.",
        ],
    },
    {
        id: "agent-commerce-protocol-demo",
        kind: "agent_commerce_protocol",
        displayName: "Agent Commerce Protocol Demo Stub",
        category: "agent_commerce",
        status: "todo_demo_stub",
        vendorIdSuggestion: "acp-provider-demo",
        authModes: ["bearer", "hmac_sha256"],
        requiredSecrets: ["ACP_API_KEY", "ACP_WEBHOOK_SECRET"],
        requiredFields: ["agentId", "intent", "budget", "receiptCallback"],
        exampleEndpoint: "https://acp.example/TODO/intents",
        payloadShape: {
            agentId: "<agent-id>",
            intent: "<natural-language-or-typed-intent>",
            budget: { amount: "<amount>", asset: "<asset>" },
            receiptCallback: "<webhook-url>",
        },
        safetyNotes: [
            "Protocol-specific integration should keep Mono as the settlement/receipt layer, not hide route risk.",
            "Require explicit user budget and policy before submitting external agent-commerce intents.",
        ],
        todos: [
            "TODO(acp): align fields with the final ACP spec and vendor permissions.",
            "TODO(acp): map external intent state to MCP receipts and runbook state.",
            "TODO(acp): verify callbacks and prevent replay.",
        ],
    },
    {
        id: "universal-commerce-protocol-demo",
        kind: "universal_commerce_protocol",
        displayName: "Universal Commerce Protocol Demo Stub",
        category: "agent_commerce",
        status: "todo_demo_stub",
        vendorIdSuggestion: "ucp-provider-demo",
        authModes: ["bearer", "hmac_sha256"],
        requiredSecrets: ["UCP_API_KEY", "UCP_WEBHOOK_SECRET"],
        requiredFields: ["merchantId", "cart", "budget", "delivery"],
        exampleEndpoint: "https://ucp.example/TODO/carts",
        payloadShape: {
            merchantId: "<merchant-id>",
            cart: [{ sku: "<sku>", quantity: 1 }],
            budget: { amount: "<amount>", asset: "<asset>" },
            delivery: "TODO(demo): typed delivery/contact object",
        },
        safetyNotes: [
            "Demo only. Treat external commerce protocol calls as vendor integrations with their own fraud/refund/terms risk.",
            "The MCP should render the exact cart, merchant, total, route risk, and receipt path before approval.",
        ],
        todos: [
            "TODO(ucp): align with the final UCP API and signature model.",
            "TODO(ucp): map fulfillment and refund events to local receipts.",
            "TODO(ucp): add merchant allowlist and risk policy controls.",
        ],
    },
];
export function listDemoConnectorTemplates(args = {}) {
    return TEMPLATES
        .filter((template) => !args.kind || template.kind === args.kind)
        .filter((template) => !args.category || template.category === args.category)
        .map(redactTemplate);
}
export function getDemoConnectorTemplate(id) {
    const template = TEMPLATES.find((item) => item.id === id);
    if (!template) {
        throw new Error(`demo connector template '${id}' not found`);
    }
    return template;
}
export function demoConnectorDraft(args) {
    const template = getDemoConnectorTemplate(args.templateId);
    const authMode = args.authMode ?? template.authModes[0];
    if (!template.authModes.includes(authMode)) {
        throw new Error(`authMode '${authMode}' is not supported by template '${template.id}'`);
    }
    const vendorId = args.vendorId ?? template.vendorIdSuggestion;
    return {
        template: redactTemplate(template),
        connectorSetDraft: {
            id: `${vendorId}-${template.kind}`,
            vendorId,
            displayName: template.displayName,
            endpoint: args.endpoint ?? template.exampleEndpoint,
            method: "POST",
            enabled: false,
            authMode,
            secret: "<store-with-connector_set-confirmation>",
            confirm: "STORE_CONNECTOR",
        },
        payloadPreview: template.payloadShape,
        requiredFields: template.requiredFields,
        requiredSecrets: template.requiredSecrets,
        warnings: [
            "TODO/demo stub only. Do not enable this connector until a real provider agreement, credentials, webhook verification, and policy review exist.",
            ...template.safetyNotes,
        ],
        todos: template.todos,
    };
}
function redactTemplate(template) {
    return {
        id: template.id,
        kind: template.kind,
        displayName: template.displayName,
        category: template.category,
        status: template.status,
        vendorIdSuggestion: template.vendorIdSuggestion,
        authModes: template.authModes,
        requiredSecrets: template.requiredSecrets,
        requiredFields: template.requiredFields,
        exampleEndpoint: template.exampleEndpoint,
        safetyNotes: template.safetyNotes,
        todos: template.todos,
    };
}
