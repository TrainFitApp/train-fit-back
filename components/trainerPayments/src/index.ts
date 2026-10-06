// Núcleo puro (TypeScript estricto) del dominio de cobros entrenador → cliente.
// La capa CommonJS (components/trainerPayments/*.js) lo carga compilado desde
// .build/trainer-payments a través de core.js.
export * from "./types";
export * from "./money";
export * from "./calendar";
export * from "./ledger";
export * from "./plan";
export * from "./reminders";
export * from "./dto";
