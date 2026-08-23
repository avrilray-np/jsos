export type ServerConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  openAiApiKey: string;
};

export function getServerConfig(): ServerConfig {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  };
}

export function isCloudConfigured() {
  const config = getServerConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey);
}
