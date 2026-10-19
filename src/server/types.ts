export interface AiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

export type Env = {
  AI: AiBinding;
  GLOSSARY_DB?: D1Database;
  GLOSSARY_INDEX?: VectorizeIndex;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  APP_ENV?: string;
  APP_ACCESS_PASSWORD?: string;
  TRANSLATION_MODEL?: string;
  STT_MODEL?: string;
  ALLOWED_ORIGIN?: string;
};

export type Variables = {
  requestId: string;
  startedAt: number;
};
