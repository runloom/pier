declare const mainPluginContextBrand: unique symbol;

export interface MainPluginContext {
  readonly [mainPluginContextBrand]?: never;
}

export interface MainPluginModule {
  activate(context: MainPluginContext): () => void;
  id: string;
}
