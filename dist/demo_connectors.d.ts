export type DemoConnectorKind = "stripe" | "coinsbee" | "travel" | "food" | "service_provider" | "agent_commerce_protocol" | "universal_commerce_protocol";
export interface DemoConnectorTemplate {
    id: string;
    kind: DemoConnectorKind;
    displayName: string;
    category: string;
    status: "todo_demo_stub";
    vendorIdSuggestion: string;
    authModes: Array<"bearer" | "header" | "hmac_sha256">;
    requiredSecrets: string[];
    requiredFields: string[];
    exampleEndpoint: string;
    payloadShape: Record<string, unknown>;
    safetyNotes: string[];
    todos: string[];
}
export declare function listDemoConnectorTemplates(args?: {
    kind?: DemoConnectorKind;
    category?: string;
}): {
    id: string;
    kind: DemoConnectorKind;
    displayName: string;
    category: string;
    status: "todo_demo_stub";
    vendorIdSuggestion: string;
    authModes: ("bearer" | "header" | "hmac_sha256")[];
    requiredSecrets: string[];
    requiredFields: string[];
    exampleEndpoint: string;
    safetyNotes: string[];
    todos: string[];
}[];
export declare function getDemoConnectorTemplate(id: string): DemoConnectorTemplate;
export declare function demoConnectorDraft(args: {
    templateId: string;
    vendorId?: string;
    endpoint?: string;
    authMode?: "bearer" | "header" | "hmac_sha256";
}): {
    template: {
        id: string;
        kind: DemoConnectorKind;
        displayName: string;
        category: string;
        status: "todo_demo_stub";
        vendorIdSuggestion: string;
        authModes: ("bearer" | "header" | "hmac_sha256")[];
        requiredSecrets: string[];
        requiredFields: string[];
        exampleEndpoint: string;
        safetyNotes: string[];
        todos: string[];
    };
    connectorSetDraft: {
        id: string;
        vendorId: string;
        displayName: string;
        endpoint: string;
        method: string;
        enabled: boolean;
        authMode: "bearer" | "header" | "hmac_sha256";
        secret: string;
        confirm: string;
    };
    payloadPreview: Record<string, unknown>;
    requiredFields: string[];
    requiredSecrets: string[];
    warnings: string[];
    todos: string[];
};
